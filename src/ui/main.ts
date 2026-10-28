import './styles.css';
import type { HouseViewerFactory, ViewerFactory } from '../viewer3d';
import { mountShell } from './shell';

/**
 * The 3D library is loaded on demand, after the editor is already usable, so
 * the page appears quickly and the editor works even if 3D never loads.
 */
const viewerFactory: ViewerFactory = async (container, handlers) => {
  const { createWallViewer } = await import('../viewer3d');
  return createWallViewer(container, handlers);
};
const houseViewerFactory: HouseViewerFactory = async (container, handlers) => {
  const { createHouseViewer } = await import('../viewer3d');
  return createHouseViewer(container, handlers);
};

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing <div id="app"> in index.html');
}
// The address keeps the workspace: …/#building opens the building envelope.
mountShell(root, {
  viewerFactory,
  houseViewerFactory,
  initialMode: location.hash === '#building' ? 'building' : 'wall',
  onModeChange: (mode) => history.replaceState(null, '', mode === 'building' ? '#building' : location.pathname + location.search),
});
