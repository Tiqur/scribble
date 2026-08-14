/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {name as appName} from './app.json';
import App from './App';
import {PluginManager, EventType} from 'sn-plugin-lib';
import {LOG} from './src/constants';
import {onScribblePenUp} from './src/logic/scribble';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();
console.log(`${LOG} PluginManager.init() called`);

// Scribble is gesture-driven, not button-driven: it reacts to the drawing
// gesture itself. Register a PEN_UP listener (registerType 1 = normal ordering);
// the lib mutates the payload elements in place via transformElements, so each
// drawn element carries a uuid-keyed points accessor for classification.
PluginManager.registerEventListener(EventType.PEN_UP, 1, {
  onMsg: data => {
    onScribblePenUp(data);
  },
});
console.log(`${LOG} PEN_UP listener registered`);

// Settings panel entry points: the note app's config button (the standard
// plugin-settings slot) and a sidebar button. Both open the same App.tsx view.
function openSettings() {
  try {
    PluginManager.showPluginView();
  } catch (error) {
    console.error(`${LOG} showPluginView failed:`, error);
  }
}

PluginManager.registerConfigButton()
  .then(ok => console.log(`${LOG} config button registered: ${ok}`))
  .catch(error => console.error(`${LOG} registerConfigButton failed:`, error));
PluginManager.registerConfigButtonListener({onClick: openSettings});

const sidebarButton = {
  id: 'scribble_settings',
  name: 'Scribble settings',
  color: 0,
  icon: 'ic_launcher',
  bgColor: -1,
  expandMenuItem: 0,
};
PluginManager.registerButton(1, ['NOTE'], sidebarButton)
  .then(ok => console.log(`${LOG} sidebar button registered: ${ok}`))
  .catch(error => console.error(`${LOG} registerButton failed:`, error));
PluginManager.registerButtonListener({
  onButtonPress: event => {
    if (event && event.id === 'scribble_settings') {
      openSettings();
    }
  },
});
console.log(`${LOG} settings entry points registered`);
