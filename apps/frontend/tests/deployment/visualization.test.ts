import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Deployment Pipeline Visualization Tests
 * 
 * Tests verify that deployment pipeline visualization accurately represents
 * deployment progress through all stages with correct percentage calculations
 * and real-time update mechanisms.
 */

interface DeploymentStage {
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

interface DeploymentVisualization {
  stages: DeploymentStage[];
  overallProgress: number;
  currentStage: string;
  isComplete: boolean;
  isFailed: boolean;
}

// Mock deployment data
const mockDeploymentStages: DeploymentStage[] = [
  { name: 'Repository Setup', status: 'completed', progress: 100 },
  { name: 'Build', status: 'in-progress', progress: 50 },
  { name: 'Deploy', status: 'pending', progress: 0 },
  { name: 'Verification', status: 'pending', progress: 0 },
];

function calculateOverallProgress(stages: DeploymentStage[]): number {
  if (stages.length === 0) return 0;
  const totalProgress = stages.reduce((sum, stage) => sum + stage.progress, 0);
  return Math.round(totalProgress / stages.length);
}

function getCurrentStage(stages: DeploymentStage[]): string {
  const inProgress = stages.find(s => s.status === 'in-progress');
  if (inProgress) return inProgress.name;
  
  const pending = stages.find(s => s.status === 'pending');
  if (pending) return pending.name;
  
  return stages[stages.length - 1]?.name || 'Unknown';
}

function isDeploymentComplete(stages: DeploymentStage[]): boolean {
  return stages.every(s => s.status === 'completed');
}

function isDeploymentFailed(stages: DeploymentStage[]): boolean {
  return stages.some(s => s.status === 'failed');
}

function buildVisualization(stages: DeploymentStage[]): DeploymentVisualization {
  return {
    stages,
    overallProgress: calculateOverallProgress(stages),
    currentStage: getCurrentStage(stages),
    isComplete: isDeploymentComplete(stages),
    isFailed: isDeploymentFailed(stages),
  };
}

describe('Deployment Pipeline Visualization', () => {
  describe('Stage Rendering', () => {
    it('should render all pipeline stages', () => {
      const viz = buildVisualization(mockDeploymentStages);
      
      expect(viz.stages).toHaveLength(4);
      expect(viz.stages.map(s => s.name)).toEqual([
        'Repository Setup',
        'Build',
        'Deploy',
        'Verification',
      ]);
    });

    it('should display correct status for each stage', () => {
      const viz = buildVisualization(mockDeploymentStages);
      
      expect(viz.stages[0].status).toBe('completed');
      expect(viz.stages[1].status).toBe('in-progress');
      expect(viz.stages[2].status).toBe('pending');
      expect(viz.stages[3].status).toBe('pending');
    });

    it('should render stages with correct visual indicators', () => {
      const viz = buildVisualization(mockDeploymentStages);
      
      const completedStage = viz.stages[0];
      expect(completedStage.progress).toBe(100);
      
      const inProgressStage = viz.stages[1];
      expect(inProgressStage.progress).toBe(50);
      
      const pendingStage = viz.stages[2];
      expect(pendingStage.progress).toBe(0);
    });
  });

  describe('Progress Percentage Accuracy', () => {
    it('should calculate overall progress correctly', () => {
      const viz = buildVisualization(mockDeploymentStages);
      
      // (100 + 50 + 0 + 0) / 4 = 37.5 → 38
      expect(viz.overallProgress).toBe(38);
    });

    it('should show 0% progress when all stages are pending', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'pending', progress: 0 },
        { name: 'Stage 2', status: 'pending', progress: 0 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(0);
    });

    it('should show 100% progress when all stages are completed', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'completed', progress: 100 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(100);
    });

    it('should update progress as stages complete', () => {
      const stages = [...mockDeploymentStages];
      
      let viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(38);
      
      // Complete Build stage
      stages[1].status = 'completed';
      stages[1].progress = 100;
      stages[2].status = 'in-progress';
      stages[2].progress = 25;
      
      viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(56); // (100 + 100 + 25 + 0) / 4
    });

    it('should handle partial progress in stages', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'in-progress', progress: 75 },
        { name: 'Stage 3', status: 'pending', progress: 0 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(58); // (100 + 75 + 0) / 3
    });
  });

  describe('Current Stage Tracking', () => {
    it('should identify in-progress stage as current', () => {
      const viz = buildVisualization(mockDeploymentStages);
      expect(viz.currentStage).toBe('Build');
    });

    it('should identify next pending stage when no in-progress stage', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'pending', progress: 0 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.currentStage).toBe('Stage 2');
    });

    it('should identify last stage when all completed', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'completed', progress: 100 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.currentStage).toBe('Stage 2');
    });
  });

  describe('Error State Visualization', () => {
    it('should mark deployment as failed when stage fails', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'failed', progress: 0, error: 'Build failed' },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.isFailed).toBe(true);
    });

    it('should display error message for failed stage', () => {
      const stages: DeploymentStage[] = [
        { name: 'Build', status: 'failed', progress: 0, error: 'npm install failed' },
      ];
      
      const viz = buildVisualization(stages);
      const failedStage = viz.stages.find(s => s.status === 'failed');
      
      expect(failedStage?.error).toBe('npm install failed');
    });

    it('should not mark as failed when no stages have failed', () => {
      const viz = buildVisualization(mockDeploymentStages);
      expect(viz.isFailed).toBe(false);
    });

    it('should show error state in visualization', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'failed', progress: 50, error: 'Deployment failed' },
        { name: 'Stage 3', status: 'pending', progress: 0 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.isFailed).toBe(true);
      expect(viz.stages[1].error).toBeDefined();
    });
  });

  describe('Completion State', () => {
    it('should mark deployment as complete when all stages completed', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'completed', progress: 100 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.isComplete).toBe(true);
    });

    it('should not mark as complete when stages are pending', () => {
      const viz = buildVisualization(mockDeploymentStages);
      expect(viz.isComplete).toBe(false);
    });

    it('should not mark as complete when stages are in-progress', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'in-progress', progress: 50 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.isComplete).toBe(false);
    });

    it('should show 100% progress when complete', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'completed', progress: 100 },
        { name: 'Stage 2', status: 'completed', progress: 100 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(100);
      expect(viz.isComplete).toBe(true);
    });
  });

  describe('Real-time Updates', () => {
    it('should update visualization when stage progresses', () => {
      const stages = [...mockDeploymentStages];
      let viz = buildVisualization(stages);
      
      expect(viz.stages[1].progress).toBe(50);
      
      // Simulate progress update
      stages[1].progress = 75;
      viz = buildVisualization(stages);
      
      expect(viz.stages[1].progress).toBe(75);
      expect(viz.overallProgress).toBe(44); // (100 + 75 + 0 + 0) / 4
    });

    it('should update current stage when stage completes', () => {
      const stages = [...mockDeploymentStages];
      let viz = buildVisualization(stages);
      
      expect(viz.currentStage).toBe('Build');
      
      // Complete Build, start Deploy
      stages[1].status = 'completed';
      stages[1].progress = 100;
      stages[2].status = 'in-progress';
      stages[2].progress = 10;
      
      viz = buildVisualization(stages);
      expect(viz.currentStage).toBe('Deploy');
    });

    it('should reflect completion status changes', () => {
      const stages = [...mockDeploymentStages];
      let viz = buildVisualization(stages);
      
      expect(viz.isComplete).toBe(false);
      
      // Complete all stages
      stages.forEach(s => {
        s.status = 'completed';
        s.progress = 100;
      });
      
      viz = buildVisualization(stages);
      expect(viz.isComplete).toBe(true);
      expect(viz.overallProgress).toBe(100);
    });

    it('should handle rapid stage transitions', () => {
      const stages: DeploymentStage[] = [
        { name: 'Stage 1', status: 'pending', progress: 0 },
        { name: 'Stage 2', status: 'pending', progress: 0 },
      ];
      
      // Rapid transitions
      stages[0].status = 'in-progress';
      stages[0].progress = 50;
      let viz = buildVisualization(stages);
      expect(viz.currentStage).toBe('Stage 1');
      
      stages[0].status = 'completed';
      stages[0].progress = 100;
      stages[1].status = 'in-progress';
      stages[1].progress = 25;
      viz = buildVisualization(stages);
      expect(viz.currentStage).toBe('Stage 2');
      
      stages[1].status = 'completed';
      stages[1].progress = 100;
      viz = buildVisualization(stages);
      expect(viz.isComplete).toBe(true);
    });
  });

  describe('Visualization Performance', () => {
    it('should handle large number of stages efficiently', () => {
      const stages: DeploymentStage[] = Array.from({ length: 100 }, (_, i) => ({
        name: `Stage ${i + 1}`,
        status: i < 50 ? 'completed' : 'pending',
        progress: i < 50 ? 100 : 0,
      }));
      
      const start = performance.now();
      const viz = buildVisualization(stages);
      const duration = performance.now() - start;
      
      expect(viz.stages).toHaveLength(100);
      expect(duration).toBeLessThan(10); // Should complete in < 10ms
    });

    it('should update visualization quickly', () => {
      const stages = [...mockDeploymentStages];
      
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        stages[1].progress = (i % 100);
        buildVisualization(stages);
      }
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(100); // 1000 updates in < 100ms
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stages array', () => {
      const viz = buildVisualization([]);
      
      expect(viz.stages).toHaveLength(0);
      expect(viz.overallProgress).toBe(0);
      expect(viz.isComplete).toBe(false);
    });

    it('should handle single stage deployment', () => {
      const stages: DeploymentStage[] = [
        { name: 'Deploy', status: 'in-progress', progress: 50 },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.overallProgress).toBe(50);
      expect(viz.currentStage).toBe('Deploy');
    });

    it('should handle stages with timestamps', () => {
      const now = new Date();
      const stages: DeploymentStage[] = [
        {
          name: 'Stage 1',
          status: 'completed',
          progress: 100,
          startedAt: new Date(now.getTime() - 60000),
          completedAt: now,
        },
      ];
      
      const viz = buildVisualization(stages);
      expect(viz.stages[0].startedAt).toBeDefined();
      expect(viz.stages[0].completedAt).toBeDefined();
    });
  });
});
