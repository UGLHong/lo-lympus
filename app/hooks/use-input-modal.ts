import { useCallback, useState } from 'react';

export interface UseInputModalState {
  isOpen: boolean;
  title: string;
  context?: string;
  placeholder?: string;
  options?: string[];
  isLoading?: boolean;
}

export interface UseInputModalActions {
  open: (config: Omit<UseInputModalState, 'isOpen'>) => void;
  close: () => void;
  setLoading: (loading: boolean) => void;
}

export function useInputModal(
  onSubmit: (value: string) => Promise<void> | void,
): [UseInputModalState, UseInputModalActions] {
  const [state, setState] = useState<UseInputModalState>({
    isOpen: false,
    title: '',
  });

  const open = useCallback((config: Omit<UseInputModalState, 'isOpen'>) => {
    setState({ ...config, isOpen: true });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  return [state, { open, close, setLoading }];
}
