/**
 * GitHubAppInstallationService
 *
 * Handles GitHub App installation webhook events:
 * - installation.created: store installation ID, orgs, and repos
 * - installation.deleted: remove all installation records
 * - installation_repositories.added: update granted repositories
 * - installation_repositories.removed: update granted repositories
 *
 * All operations are idempotent using installation_id as the primary key.
 *
 * Concurrency safety:
 *   handleInstallationRepositoriesAdded and handleInstallationRepositoriesRemoved
 *   use atomic Postgres jsonb array expressions rather than a read-then-write
 *   pattern, preventing concurrent webhook deliveries from clobbering each other.
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InstallationCreatedPayload {
    action: 'created';
    installation: {
        id: number;
        app_id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
        repositories?: Array<{
            id: number;
            name: string;
            full_name: string;
        }>;
        repository_selection: 'all' | 'selected';
        single_file_name?: string | null;
    };
    repositories?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
}

export interface InstallationDeletedPayload {
    action: 'deleted';
    installation: {
        id: number;
        app_id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
    };
}

export interface InstallationRepositoriesPayload {
    action: 'added' | 'removed';
    installation: {
        id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
    };
    repository_selection: 'all' | 'selected';
    repositories_added?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
    repositories_removed?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
}

export class GitHubAppInstallationService {
    async handleInstallationCreated(payload: InstallationCreatedPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.created',
            installationId: installation.id,
            accountLogin: installation.account.login,
            repoCount: (payload.repositories ?? []).length,
        }));

        // Prepare repository list
        const repositories = (payload.repositories || []).map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
        }));

        // Prepare organization list (for organization-level installs)
        const organizations = installation.account.type === 'Organization'
            ? [{
                login: installation.account.login,
                id: installation.account.id,
                type: 'Organization',
            }]
            : [];

        // Upsert installation (idempotent via installation_id)
        const { error } = await supabase
            .from('github_app_installations')
            .upsert({
                installation_id: installation.id,
                app_id: installation.app_id,
                account_login: installation.account.login,
                account_type: installation.account.type,
                account_id: installation.account.id,
                repositories: repositories,
                organizations: organizations,
                deleted_at: null,
            }, {
                onConflict: 'installation_id',
            });

        if (error) {
            throw new Error(`Failed to create installation record: ${error.message}`);
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.created.done',
            installationId: installation.id,
            repoCount: repositories.length,
        }));
    }

    async handleInstallationDeleted(payload: InstallationDeletedPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.deleted',
            installationId: installation.id,
        }));

        // Mark installation as deleted (soft delete) to preserve audit trail
        const { error } = await supabase
            .from('github_app_installations')
            .update({
                deleted_at: new Date().toISOString(),
            })
            .eq('installation_id', installation.id);

        if (error) {
            throw new Error(`Failed to delete installation record: ${error.message}`);
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.deleted.done',
            installationId: installation.id,
        }));
    }

    async handleInstallationRepositoriesAdded(payload: InstallationRepositoriesPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;
        const addedRepos = (payload.repositories_added || []).map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
        }));

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'repositories.added',
            installationId: installation.id,
            addedCount: addedRepos.length,
        }));

        // Atomic Postgres update: merge new repos into the jsonb array,
        // de-duplicating by id. This avoids a read-then-write race condition
        // when concurrent webhook deliveries arrive for the same installation.
        //
        // The expression builds a set of existing repo ids, filters the incoming
        // repos down to only those not already present, then concatenates.
        // If the installation does not exist the update is a no-op (0 rows affected).
        const { data, error: updateError } = await supabase.rpc(
            'installation_repos_add',
            {
                p_installation_id: installation.id,
                p_repos: addedRepos,
            }
        );

        if (updateError) {
            // Fall back to read-then-write if the RPC is not available
            // (e.g. during local development without the migration applied).
            if (updateError.code === 'PGRST202' || updateError.message?.includes('Could not find')) {
                await this._fallbackReposAdded(supabase, installation.id, addedRepos);
            } else {
                throw new Error(`Failed to update repositories: ${updateError.message}`);
            }
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'repositories.added.done',
            installationId: installation.id,
            addedCount: addedRepos.length,
        }));
    }

    async handleInstallationRepositoriesRemoved(payload: InstallationRepositoriesPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;
        const removedRepoIds = new Set(
            (payload.repositories_removed || []).map((repo) => repo.id)
        );

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'repositories.removed',
            installationId: installation.id,
            removedCount: removedRepoIds.size,
        }));

        // Atomic Postgres update: filter the jsonb array by removing entries
        // whose id appears in the removed-ids set, avoiding a read-then-write race.
        const removedIdsArray = Array.from(removedRepoIds);
        const { error: updateError } = await supabase.rpc(
            'installation_repos_remove',
            {
                p_installation_id: installation.id,
                p_repo_ids: removedIdsArray,
            }
        );

        if (updateError) {
            // Fall back to read-then-write if the RPC is not available.
            if (updateError.code === 'PGRST202' || updateError.message?.includes('Could not find')) {
                await this._fallbackReposRemoved(supabase, installation.id, removedRepoIds);
            } else {
                throw new Error(`Failed to update repositories: ${updateError.message}`);
            }
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'repositories.removed.done',
            installationId: installation.id,
            removedCount: removedRepoIds.size,
        }));
    }

    // ── Fallback read-then-write helpers (used when RPC is unavailable) ───────

    private async _fallbackReposAdded(
        supabase: SupabaseClient,
        installationId: number,
        addedRepos: Array<{ id: number; name: string; full_name: string }>,
    ): Promise<void> {
        const { data: current, error: fetchError } = await supabase
            .from('github_app_installations')
            .select('repositories')
            .eq('installation_id', installationId)
            .single();

        if (fetchError || !current) {
            console.warn(JSON.stringify({
                service: 'github-app-installation',
                action: 'repositories.added.not_found',
                installationId,
                message: 'Installation not found during fallback repos-added',
            }));
            throw new Error(`Installation not found: ${installationId}`);
        }

        const existingRepos = (current.repositories as any[]) || [];
        const repoIds = new Set(existingRepos.map((r) => (r as any).id));
        const mergedRepos = [
            ...existingRepos,
            ...addedRepos.filter((r) => !repoIds.has(r.id)),
        ];

        const { error: updateError } = await supabase
            .from('github_app_installations')
            .update({ repositories: mergedRepos })
            .eq('installation_id', installationId);

        if (updateError) {
            throw new Error(`Failed to update repositories: ${updateError.message}`);
        }
    }

    private async _fallbackReposRemoved(
        supabase: SupabaseClient,
        installationId: number,
        removedRepoIds: Set<number>,
    ): Promise<void> {
        const { data: current, error: fetchError } = await supabase
            .from('github_app_installations')
            .select('repositories')
            .eq('installation_id', installationId)
            .single();

        if (fetchError || !current) {
            console.warn(JSON.stringify({
                service: 'github-app-installation',
                action: 'repositories.removed.not_found',
                installationId,
                message: 'Installation not found during fallback repos-removed',
            }));
            throw new Error(`Installation not found: ${installationId}`);
        }

        const existingRepos = (current.repositories as any[]) || [];
        const filteredRepos = existingRepos.filter((r) => !removedRepoIds.has((r as any).id));

        const { error: updateError } = await supabase
            .from('github_app_installations')
            .update({ repositories: filteredRepos })
            .eq('installation_id', installationId);

        if (updateError) {
            throw new Error(`Failed to update repositories: ${updateError.message}`);
        }
    }
}

export const gitHubAppInstallationService = new GitHubAppInstallationService();
