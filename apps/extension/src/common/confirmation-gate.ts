export interface OperationConfirmation { title: string; message: string; }

/** Each confirmation authorizes one caller only, even when buttons are clicked repeatedly. */
export function createConfirmationGate(present: (details: OperationConfirmation, finish: (approved: boolean) => void) => () => void) {
  let pending = false;
  return (details: OperationConfirmation): Promise<boolean> => {
    if (pending) return Promise.resolve(false);
    pending = true;
    return new Promise(resolve => {
      let settled = false, cleanup: (() => void) | undefined;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        pending = false;
        try { cleanup?.(); }
        finally { resolve(approved === true); }
      };
      try {
        cleanup = present(details, finish);
        if (settled) cleanup();
      } catch { finish(false); }
    });
  };
}
