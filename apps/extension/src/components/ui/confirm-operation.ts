import { createApp, h } from 'vue';
import { createConfirmationGate } from '../../common/confirmation-gate';
import OperationConfirmDialog from './OperationConfirmDialog.vue';

export const confirmOperation = createConfirmationGate((details, finish) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({render: () => h(OperationConfirmDialog, {...details, onAnswer: finish})});
  const cancel = () => finish(false);
  window.addEventListener('pagehide', cancel);
  try { app.mount(host); }
  catch (error) { window.removeEventListener('pagehide', cancel); host.remove(); throw error; }
  return () => { window.removeEventListener('pagehide', cancel); app.unmount(); host.remove(); };
});
