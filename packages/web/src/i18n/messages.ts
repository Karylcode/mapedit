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
};
