import { useUi } from './ui-context';

export function useFollowMode(): { followRole: string | null; setFollowRole: (role: string | null) => void } {
  const { followRole, setFollowRole } = useUi();
  return { followRole, setFollowRole };
}

export function useWatchMode(): { watchStatus: string | null; setWatchStatus: (status: string | null) => void } {
  const { watchStatus, setWatchStatus } = useUi();
  return { watchStatus, setWatchStatus };
}
