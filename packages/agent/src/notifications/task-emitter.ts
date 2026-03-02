import { notify } from './engine.ts';

export async function notifyTaskFailure(taskId: string, taskTitle: string, error: string): Promise<void> {
  await notify({
    type: 'task_failure',
    severity: 'warning',
    title: `Tâche échouée : ${taskTitle}`,
    body: error.length > 200 ? error.slice(0, 200) + '…' : error,
    link: '/tasks',
  });
}

export async function notifyCronResult(taskTitle: string, summary: string, durationMs: number): Promise<void> {
  const durationLabel = durationMs > 60_000
    ? `${Math.round(durationMs / 60_000)}min`
    : `${Math.round(durationMs / 1_000)}s`;
  await notify({
    type: 'cron_result',
    severity: 'info',
    title: `Tâche terminée : ${taskTitle}`,
    body: `Durée : ${durationLabel}\n${summary.length > 300 ? summary.slice(0, 300) + '…' : summary}`,
    link: '/tasks',
  });
}

export async function notifyCatalogUpdate(newModelsCount: number): Promise<void> {
  if (newModelsCount === 0) return;
  await notify({
    type: 'catalog_update',
    severity: 'info',
    title: 'Catalogue LLM mis à jour',
    body: `${newModelsCount} nouveau${newModelsCount > 1 ? 'x' : ''} modèle${newModelsCount > 1 ? 's' : ''} disponible${newModelsCount > 1 ? 's' : ''}.`,
    link: '/models',
  });
}

export async function notifySystemAlert(message: string, severity: 'warning' | 'critical' = 'critical'): Promise<void> {
  await notify({
    type: 'system_alert',
    severity,
    title: 'Alerte système',
    body: message.length > 300 ? message.slice(0, 300) + '…' : message,
  });
}
