// Shared data for every tab in the owner workspace.
import { createContext, useContext } from 'react';

export const OwnerContext = createContext(null);

export function useOwner() {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error('useOwner must be used inside the owner workspace');
  return ctx;
}
