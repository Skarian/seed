import { useCallback, useEffect, useState } from 'react';
export type WorkspacePage = 'generate' | 'chat' | 'library' | 'admin';
const paths: Record<WorkspacePage, string> = {
  generate: '/',
  chat: '/chat',
  library: '/library',
  admin: '/admin',
};
function currentPage(): WorkspacePage {
  return (Object.entries(paths).find(([, path]) => path === location.pathname)?.[0] ??
    'generate') as WorkspacePage;
}
export function useNavigation() {
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    const change = () => setPage(currentPage());
    window.addEventListener('popstate', change);
    return () => window.removeEventListener('popstate', change);
  }, []);
  const navigate = useCallback((page: WorkspacePage) => {
    setPage(page);
    history.pushState(null, '', paths[page]);
  }, []);
  return { page, navigate };
}
