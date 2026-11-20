import { mountCloudDevicesPanel } from './cloud-devices';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('GRIXDroid workspace root was not found.');
}

mountCloudDevicesPanel(app);
