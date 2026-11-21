import { mountCloudDevicesPanel } from './cloud-devices';
import { mountWorkspaceExperience } from './workspace-experience';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('GRIXDroid workspace root was not found.');
}

mountCloudDevicesPanel(app);
mountWorkspaceExperience();
