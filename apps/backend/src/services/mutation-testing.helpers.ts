/**
 * Mutation Testing Helpers
 *
 * Utilities for asserting state machine transitions and boundary conditions
 * in deployment pipeline tests. These helpers ensure that invalid state
 * transitions are properly rejected and that boundary conditions are tested.
 *
 * Issue: #537
 */

import type { DeploymentStatusType } from '@craft/types';

/**
 * Valid state transitions in the deployment pipeline.
 * Maps from current state to allowed next states.
 */
export const VALID_STATE_TRANSITIONS: Record<DeploymentStatusType, DeploymentStatusType[]> = {
    pending: ['generating', 'failed'],
    generating: ['validating', 'failed'],
    validating: ['signing', 'failed'],
    signing: ['creating_repo', 'failed'],
    creating_repo: ['pushing_code', 'failed'],
    pushing_code: ['deploying', 'failed'],
    deploying: ['verifying_contract', 'completed', 'failed'],
    verifying_contract: ['completed', 'failed'],
    completed: [],
    failed: [],
};

/**
 * Assert that a state transition is valid.
 * Throws if the transition is not allowed.
 */
export function assertValidTransition(
    fromState: DeploymentStatusType,
    toState: DeploymentStatusType,
): void {
    const allowedTransitions = VALID_STATE_TRANSITIONS[fromState];
    if (!allowedTransitions.includes(toState)) {
        throw new Error(
            `Invalid state transition: ${fromState} → ${toState}. ` +
            `Allowed transitions: ${allowedTransitions.join(', ')}`
        );
    }
}

/**
 * Assert that a state transition is invalid.
 * Throws if the transition is actually valid.
 */
export function assertInvalidTransition(
    fromState: DeploymentStatusType,
    toState: DeploymentStatusType,
): void {
    const allowedTransitions = VALID_STATE_TRANSITIONS[fromState];
    if (allowedTransitions.includes(toState)) {
        throw new Error(
            `Expected invalid transition but ${fromState} → ${toState} is allowed`
        );
    }
}

/**
 * Get all invalid transitions from a given state.
 */
export function getInvalidTransitions(fromState: DeploymentStatusType): DeploymentStatusType[] {
    const allStates: DeploymentStatusType[] = [
        'pending',
        'generating',
        'validating',
        'signing',
        'creating_repo',
        'pushing_code',
        'deploying',
        'verifying_contract',
        'completed',
        'failed',
    ];
    const allowedTransitions = VALID_STATE_TRANSITIONS[fromState];
    return allStates.filter((state) => !allowedTransitions.includes(state));
}

/**
 * Boundary condition: terminal states should not transition to any other state.
 */
export function assertTerminalState(state: DeploymentStatusType): void {
    const transitions = VALID_STATE_TRANSITIONS[state];
    if (transitions.length > 0) {
        throw new Error(
            `Expected ${state} to be terminal, but it has transitions: ${transitions.join(', ')}`
        );
    }
}

/**
 * Boundary condition: non-terminal states must have at least one valid transition.
 */
export function assertNonTerminalState(state: DeploymentStatusType): void {
    const transitions = VALID_STATE_TRANSITIONS[state];
    if (transitions.length === 0) {
        throw new Error(`Expected ${state} to be non-terminal, but it has no transitions`);
    }
}

/**
 * Verify that all states in the transition map are reachable from 'pending'.
 */
export function assertAllStatesReachable(): void {
    const visited = new Set<DeploymentStatusType>();
    const queue: DeploymentStatusType[] = ['pending'];

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;

        visited.add(current);
        const nextStates = VALID_STATE_TRANSITIONS[current];
        for (const next of nextStates) {
            if (!visited.has(next)) {
                queue.push(next);
            }
        }
    }

    const allStates = Object.keys(VALID_STATE_TRANSITIONS) as DeploymentStatusType[];
    const unreachable = allStates.filter((state) => !visited.has(state));

    if (unreachable.length > 0) {
        throw new Error(`Unreachable states: ${unreachable.join(', ')}`);
    }
}

/**
 * Verify that there are no cycles in the state transition graph.
 */
export function assertNoCycles(): void {
    const visited = new Set<DeploymentStatusType>();
    const recursionStack = new Set<DeploymentStatusType>();

    function hasCycle(state: DeploymentStatusType): boolean {
        visited.add(state);
        recursionStack.add(state);

        const nextStates = VALID_STATE_TRANSITIONS[state];
        for (const next of nextStates) {
            if (!visited.has(next)) {
                if (hasCycle(next)) return true;
            } else if (recursionStack.has(next)) {
                return true;
            }
        }

        recursionStack.delete(state);
        return false;
    }

    const allStates = Object.keys(VALID_STATE_TRANSITIONS) as DeploymentStatusType[];
    for (const state of allStates) {
        if (!visited.has(state)) {
            if (hasCycle(state)) {
                throw new Error(`Cycle detected in state transition graph starting from ${state}`);
            }
        }
    }
}
