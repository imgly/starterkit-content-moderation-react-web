/**
 * The "Moderate Content" button in the navigation bar, next to the export it
 * gates.
 */

import type CreativeEditorSDK from '@cesdk/cesdk-js';

import { CHECK_ACTION } from './moderation-session';

/** A shield with a check mark. */
const SHIELD_ICON = `
<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="@contentmoderation/icon/shield" viewBox="0 0 24 24" fill="none">
    <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
</svg>`;

/**
 * Adds the button before the Actions dropdown. Add it after the session,
 * otherwise a click runs an action that is not registered yet.
 */
export function addModerateButton(cesdk: CreativeEditorSDK): void {
  cesdk.ui.addIconSet('@contentmoderation/icons', SHIELD_ICON);
  cesdk.ui.insertOrderComponent(
    { in: 'ly.img.navigation.bar', before: 'ly.img.actions.navigationBar' },
    {
      id: 'ly.img.action.navigationBar',
      key: 'contentModeration',
      label: 'Moderate Content',
      icon: '@contentmoderation/icon/shield',
      onClick: () => cesdk.actions.run(CHECK_ACTION)
    }
  );
}
