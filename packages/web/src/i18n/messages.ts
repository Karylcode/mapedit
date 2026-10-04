export type Params = Record<string, string | number>;
export type Message = string | ((params: Params) => string);

/** Traditional Chinese is the reference dictionary; English must match its keys. */
export const zhTW = {
  'app.name': 'mapedit',
  'lang.label': '介面語言',
  'lang.zh-TW': '中文',
  'lang.en': 'English',

  'title.project': '專案',
  'title.map': '地圖',
  'title.revision': '版次',
  'title.link': '連線',
  'title.switchMap': '切換地圖',

  'status.connecting': '連線中…',
  'status.open': '即時同步',
  'status.reconnecting': '重新連線中…',
  'status.incompatible': '伺服器版本不相容',

  'loading.server': '正在連到編輯器伺服器…',
  'loading.map': '正在載入 {name}…',
  'loading.models': (p) => `模型 ${p.loaded} / ${p.total}`,
  'loading.noMaps': '這個專案還沒有地圖。請 Agent 在 maps/ 裡建立一張。',
  'loading.failed': '地圖載入失敗：{reason}',

  'object.structure': '結構',
  'object.module': '模組',
  'object.moduleCount': '{count} 個模組',
  'marker.type.spawn': '出生點',
  'marker.type.trigger': '觸發區',

  'hover.selectModule': '再點一次，只選這個模組',
  'hover.violations': '{count} 個違規',

  'key.click': '左鍵',
  'key.rightDrag': '右鍵拖曳',
  'key.middleDrag': '中鍵拖曳',
  'key.wasd': 'WASD',
  'key.wheel': '滾輪',
  'key.drag': '拖曳',
  'action.select': '選取',
  'action.orbit': '轉動鏡頭',
  'action.pan': '移動鏡頭',
  'action.zoom': '縮放',
  'action.focus': '對焦',
  'action.wholeMap': '看整張地圖',
  'action.deselect': '取消選取',
  'action.selectModule': '再點一次選單一模組',
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof zhTW;

export const en: Record<MessageKey, Message> = {
  'app.name': 'mapedit',
  'lang.label': 'Interface language',
  'lang.zh-TW': '中文',
  'lang.en': 'English',

  'title.project': 'Project',
  'title.map': 'Map',
  'title.revision': 'Rev',
  'title.link': 'Link',
  'title.switchMap': 'Switch map',

  'status.connecting': 'Connecting…',
  'status.open': 'Live',
  'status.reconnecting': 'Reconnecting…',
  'status.incompatible': 'Incompatible server version',

  'loading.server': 'Connecting to the editor server…',
  'loading.map': 'Loading {name}…',
  'loading.models': (p) => `Models ${p.loaded} / ${p.total}`,
  'loading.noMaps': 'This project has no maps yet. Ask the Agent to create one in maps/.',
  'loading.failed': 'The map failed to load: {reason}',

  'object.structure': 'Structure',
  'object.module': 'Module',
  'object.moduleCount': (p) => (Number(p.count) === 1 ? '1 module' : `${p.count} modules`),
  'marker.type.spawn': 'Spawn point',
  'marker.type.trigger': 'Trigger zone',

  'hover.selectModule': 'Click again to select just this module',
  'hover.violations': (p) => (Number(p.count) === 1 ? '1 violation' : `${p.count} violations`),

  'key.click': 'Click',
  'key.rightDrag': 'Right-drag',
  'key.middleDrag': 'Middle-drag',
  'key.wasd': 'WASD',
  'key.wheel': 'Wheel',
  'key.drag': 'Drag',
  'action.select': 'Select',
  'action.orbit': 'Orbit',
  'action.pan': 'Pan',
  'action.zoom': 'Zoom',
  'action.focus': 'Focus',
  'action.wholeMap': 'Whole map',
  'action.deselect': 'Deselect',
  'action.selectModule': 'Click again for one module',
};
