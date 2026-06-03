import { createContext, useContext, useCallback, useState } from 'react';

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
  // Same shape as BulkUploadPage: { typeId: { status, data, progress } }
  const [states, setStates] = useState({});

  const setTypeState = useCallback((id, patch) => {
    setStates(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }));
  }, []);

  const resetTypeState = useCallback((id) => {
    setStates(prev => ({
      ...prev,
      [id]: { status: 'idle', data: null, progress: 0 },
    }));
  }, []);

  // Whether any upload is currently active
  const hasActiveUpload = Object.values(states).some(
    s => s.status === 'uploading' || s.status === 'validating'
  );

  // Most recent active/finished upload for the floating indicator
  const activeEntries = Object.entries(states).filter(
    ([, s]) => s.status && s.status !== 'idle'
  );

  return (
    <UploadContext.Provider value={{ states, setTypeState, resetTypeState, hasActiveUpload, activeEntries }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
