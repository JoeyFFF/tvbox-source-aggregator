// 内置直播分组规则：可被 KV 配置覆盖，默认值与旧代码行为一致。
// 归一化、去重、测速排序、[失效] 标记仍在 live-merger 中，不在这里。

export interface BuiltinRadioRule {
  enabled: boolean;
  groupPattern: string;
  groupExcludePattern: string;
  channelPattern: string;
  channelExcludePattern: string;
  target: string;
}

export interface BuiltinSimpleGroupRule {
  enabled: boolean;
  groups: string[];
  groupPattern: string;
  target: string;
}

export interface BuiltinDomesticRule {
  enabled: boolean;
  groupPattern: string;
  groupExact: string[];
  channelPattern: string;
  satellitePattern: string;
  localChannelPattern: string;
  genericChannelPattern: string;
  foreignPattern: string;
  target: string;
}

export interface BuiltinLocalRule {
  enabled: boolean;
  provinces: string[];
  areaSuffixes: string[];
  municipalities: string[];
  aliases: Record<string, string[]>;
  provinceLevelBrandPattern: string;
  target: string;
  provinceLevelTarget: string;
}

export interface BuiltinRuleConfig {
  version: 1;
  radio: BuiltinRadioRule;
  local: BuiltinLocalRule;
  domestic: BuiltinDomesticRule;
  watch: BuiltinSimpleGroupRule;
  rotation: BuiltinSimpleGroupRule;
}

const PROVINCE_LIST = [
  '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
  '广东', '广西', '海南', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
  '青海', '宁夏', '新疆', '内蒙古',
];

const DOMESTIC_PROVINCES = '北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|内蒙古|深圳|广州|杭州|南京|武汉|成都|西安|沈阳|长春|哈尔滨|济南|郑州|长沙|合肥|福州|南昌|昆明|贵阳|南宁|海口|兰州|西宁|银川|乌鲁木齐|石家庄|太原|呼和浩特|大连|青岛|宁波|厦门|苏州|无锡|常州|徐州|温州|绍兴|嘉兴|金华|台州|珠海|佛山|东莞|中山|惠州|汕头|湛江|江门|肇庆|桂林|柳州|三亚|绵阳|德阳|宜宾|遵义|大理|丽江|拉萨|延安|宝鸡|咸阳|天水|克拉玛依|喀什|伊犁|延边|兵团|南方|东方|珠江|海峡|东南|上视|北视|津视|渝视|BRTV';

const DOMESTIC_SUFFIXES = '频道|综合|新闻|新闻综合|公共新闻|公共|都市|生活|影视|体育|少儿|科教|经济|法制|法治|文艺|国际|卫视|电视台|TV|珠江|卡通|4K|8K|一套|二套|三套|电视剧|电影|综艺|文旅|民生|娱乐|教育|购物|纪实|新闻频道|综合频道|公共频道';

const DOMESTIC_GROUP_PATTERN = '^(央视|央視|CCTV|央卫|百事通|IPV6-[12]$|备用线路$|卫视|地方$|地方频道$|💓地方频道$|小地方$|省级频道$|☘️.*频道$|睛彩|NewTV|.*地方$)';

const DOMESTIC_GROUP_EXACT = [
  '广东', '四川', '上海频道', '重庆频道', '广西频道', '天津频道', '新疆频道', '山西频道',
  '河南频道', '河北频道', '山东频道', '江苏频道', '浙江频道', '安徽频道', '福建频道',
  '江西频道', '湖北频道', '湖南频道', '海南频道', '贵州频道', '云南频道', '陕西频道',
  '甘肃频道', '青海频道', '宁夏频道', '辽宁频道', '吉林频道', '黑龙江频道', '内蒙古频道',
  '北京频道', '廣東', '衛視',
];

const DOMESTIC_CHANNEL_PATTERN = '(CCTV|CGTN|央视|中央电视|中国教育电视|CETV|中国气象|中央新影|CHC|中国交通|中国电影频道|卡酷|金鹰卡通|优漫卡通|嘉佳卡通|哈哈炫动|炫动卡通|哈哈少儿|五星体育|劲爆体育|魅力足球|快乐垂钓|天元围棋|游戏风云|极速汽车|武术世界|先锋乒羽|睛彩|NewTV|百事通|第一财经|BRTV)';

const DOMESTIC_LOCAL_PATTERN = `(${DOMESTIC_PROVINCES})(?:${DOMESTIC_SUFFIXES})`;
const DOMESTIC_GENERIC_PATTERN = '^[一-鿿]{2,8}(新闻综合|新闻频道|综合频道|公共频道|生活频道|影视频道|电视台|广播电视台|一套|二套|三套|新闻)$';
const FOREIGN_PATTERN = '(凤凰|翡翠|香港|澳门|台湾|TVB|澳亚|中天|东森|三立|民视|台视|华视|中视|非凡|寰宇|ViuTV|Now TV|开电视|亚洲卫视)';
const PROVINCE_LEVEL_BRAND_PATTERN = '(CCTV|CGTN|央视|中央电视|中国教育电视|CETV|中国气象|中央新影|CHC|中国交通|中国电影频道|卡酷|优漫卡通|金鹰卡通|嘉佳卡通|哈哈炫动|炫动卡通|哈哈少儿|五星体育|劲爆体育|魅力足球|快乐垂钓|天元围棋|游戏风云|极速汽车|武术世界|先锋乒羽|NewTV|百事通|第一财经|BRTV|优优宝贝|四海钓鱼|环球旅游|七彩戏剧|东方影视|法治天地|南国都市|农林卫视|海峡卫视|蒙语文化|之江纪录)';

const ROTATION_GROUPS = [
  '轮播', '电影点播', '🎞️电影点播', '电视剧频道', '影视频道', 'zonghe', '♨️电影',
  '🎬电影频道', '🏛经典剧场', '🇨🇳电影在线', '💓电视剧🔁', '•影视「轮播」', '•影视',
  '虎牙影视', '斗鱼影视', '经典小品',
];

export const DEFAULT_BUILTIN_RULES: BuiltinRuleConfig = {
  version: 1,
  radio: {
    enabled: true,
    groupPattern: '广播|FM|电台',
    groupExcludePattern: '电视台|电视',
    channelPattern: '广播|FM|电台',
    channelExcludePattern: '电视台|电视|频道',
    target: '__filter__',
  },
  local: {
    enabled: true,
    provinces: PROVINCE_LIST,
    areaSuffixes: ['综合', '地区'],
    municipalities: ['北京', '上海', '天津'],
    aliases: {
      内蒙古: ['内蒙古', '内蒙', '蒙语'],
      新疆: ['新疆', '维语', '哈萨克语'],
      西藏: ['西藏', '藏语'],
      青海: ['青海', '藏语'],
      广西: ['广西', '壮语'],
    },
    provinceLevelBrandPattern: PROVINCE_LEVEL_BRAND_PATTERN,
    target: '地方台',
    provinceLevelTarget: '境内电视台',
  },
  domestic: {
    enabled: true,
    groupPattern: DOMESTIC_GROUP_PATTERN,
    groupExact: DOMESTIC_GROUP_EXACT,
    channelPattern: DOMESTIC_CHANNEL_PATTERN,
    satellitePattern: '卫视',
    localChannelPattern: DOMESTIC_LOCAL_PATTERN,
    genericChannelPattern: DOMESTIC_GENERIC_PATTERN,
    foreignPattern: FOREIGN_PATTERN,
    target: '境内电视台',
  },
  watch: {
    enabled: true,
    groups: ['一起看', '原创IP', '原创', '手工绘画'],
    groupPattern: '一起看|原创IP|手工绘画',
    target: '一起看',
  },
  rotation: {
    enabled: true,
    groups: ROTATION_GROUPS,
    groupPattern: '轮播|点播|剧场|电影在线|电视剧🔁|影视',
    target: '轮播台',
  },
};

export interface CompiledBuiltinRules {
  config: BuiltinRuleConfig;
  radioGroupRe: RegExp | null;
  radioGroupExcludeRe: RegExp | null;
  radioChannelRe: RegExp | null;
  radioChannelExcludeRe: RegExp | null;
  localProvinceRe: RegExp | null;
  localAreaSuffixes: string[];
  localMunicipalities: Set<string>;
  localAliases: Record<string, string[]>;
  localProvinceBrandRe: RegExp | null;
  domesticGroupRe: RegExp | null;
  domesticGroupExact: Set<string>;
  domesticChannelRe: RegExp | null;
  domesticSatelliteRe: RegExp | null;
  domesticLocalRe: RegExp | null;
  domesticGenericRe: RegExp | null;
  domesticForeignRe: RegExp | null;
  watchGroups: Set<string>;
  watchGroupRe: RegExp | null;
  rotationGroups: Set<string>;
  rotationGroupRe: RegExp | null;
}

function re(pattern: string | undefined, flags = 'i'): RegExp | null {
  const p = String(pattern || '').trim();
  if (!p) return null;
  try {
    return new RegExp(p, flags);
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  let out = '';
  const special = '\\^$.*+?()[]{}|';
  for (const c of String(s || '')) out += special.includes(c) ? '\\' + c : c;
  return out;
}

export function compileBuiltinRules(config: BuiltinRuleConfig): CompiledBuiltinRules {
  const provinces = config.local.provinces || [];
  const suffixes = config.local.areaSuffixes || [];
  const provincePattern = provinces.length > 0
    ? `^(${provinces.map(escapeRe).join('|')})(?:${suffixes.map(escapeRe).join('|')})?$`
    : '';
  return {
    config,
    radioGroupRe: re(config.radio.groupPattern),
    radioGroupExcludeRe: re(config.radio.groupExcludePattern),
    radioChannelRe: re(config.radio.channelPattern),
    radioChannelExcludeRe: re(config.radio.channelExcludePattern),
    localProvinceRe: re(provincePattern),
    localAreaSuffixes: suffixes,
    localMunicipalities: new Set(config.local.municipalities || []),
    localAliases: config.local.aliases || {},
    localProvinceBrandRe: re(config.local.provinceLevelBrandPattern),
    domesticGroupRe: re(config.domestic.groupPattern),
    domesticGroupExact: new Set(config.domestic.groupExact || []),
    domesticChannelRe: re(config.domestic.channelPattern),
    domesticSatelliteRe: re(config.domestic.satellitePattern),
    domesticLocalRe: re(config.domestic.localChannelPattern),
    domesticGenericRe: re(config.domestic.genericChannelPattern),
    domesticForeignRe: re(config.domestic.foreignPattern),
    watchGroups: new Set(config.watch.groups || []),
    watchGroupRe: re(config.watch.groupPattern),
    rotationGroups: new Set(config.rotation.groups || []),
    rotationGroupRe: re(config.rotation.groupPattern),
  };
}

export function provinceOfGroup(group: string, compiled: CompiledBuiltinRules): string | null {
  if (!compiled.config.local.enabled || !compiled.localProvinceRe) return null;
  const m = compiled.localProvinceRe.exec(String(group || ''));
  return m ? m[1] : null;
}

function isStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value)
    && value.length <= max
    && value.every((v) => typeof v === 'string' && v.trim().length > 0);
}

function checkPattern(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${label} 必须是字符串`);
    return;
  }
  if (!value.trim()) return;
  try {
    new RegExp(value, 'i');
  } catch {
    errors.push(`${label} 不是合法正则`);
  }
}

function checkTarget(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} 不能为空`);
    return;
  }
  if (value.includes(',') || /[\r\n]/.test(value)) {
    errors.push(`${label} 不能包含逗号或换行`);
  }
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readPattern(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const p = value.trim();
  if (!p) return value;
  try {
    new RegExp(p, 'i');
    return value;
  } catch {
    return fallback;
  }
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[], max: number): string[] {
  return isStringArray(value, max) ? value.map((v) => v.trim()) : fallback;
}

/** 宽松合并：存储/导入时缺字段或类型不对，回退到默认值。 */
export function normalizeBuiltinRuleConfig(input: unknown): BuiltinRuleConfig {
  const d = DEFAULT_BUILTIN_RULES;
  if (!input || typeof input !== 'object') return JSON.parse(JSON.stringify(d));
  const raw = input as Record<string, unknown>;
  const radio = (raw.radio || {}) as Record<string, unknown>;
  const local = (raw.local || {}) as Record<string, unknown>;
  const domestic = (raw.domestic || {}) as Record<string, unknown>;
  const watch = (raw.watch || {}) as Record<string, unknown>;
  const rotation = (raw.rotation || {}) as Record<string, unknown>;
  const aliases: Record<string, string[]> = {};
  if (local.aliases && typeof local.aliases === 'object' && !Array.isArray(local.aliases)) {
    for (const [k, v] of Object.entries(local.aliases as Record<string, unknown>)) {
      if (typeof k === 'string' && isStringArray(v, 50)) aliases[k] = v.map((x) => x.trim());
    }
  }
  return {
    version: 1,
    radio: {
      enabled: readBool(radio.enabled, d.radio.enabled),
      groupPattern: readPattern(radio.groupPattern, d.radio.groupPattern),
      groupExcludePattern: readPattern(radio.groupExcludePattern, d.radio.groupExcludePattern),
      channelPattern: readPattern(radio.channelPattern, d.radio.channelPattern),
      channelExcludePattern: readPattern(radio.channelExcludePattern, d.radio.channelExcludePattern),
      target: readString(radio.target, d.radio.target),
    },
    local: {
      enabled: readBool(local.enabled, d.local.enabled),
      provinces: readStringArray(local.provinces, d.local.provinces, 100),
      areaSuffixes: readStringArray(local.areaSuffixes, d.local.areaSuffixes, 20),
      municipalities: readStringArray(local.municipalities, d.local.municipalities, 20),
      aliases: (local.aliases && typeof local.aliases === 'object' && !Array.isArray(local.aliases))
        ? aliases
        : d.local.aliases,
      provinceLevelBrandPattern: readPattern(local.provinceLevelBrandPattern, d.local.provinceLevelBrandPattern),
      target: readString(local.target, d.local.target),
      provinceLevelTarget: readString(local.provinceLevelTarget, d.local.provinceLevelTarget),
    },
    domestic: {
      enabled: readBool(domestic.enabled, d.domestic.enabled),
      groupPattern: readPattern(domestic.groupPattern, d.domestic.groupPattern),
      groupExact: readStringArray(domestic.groupExact, d.domestic.groupExact, 500),
      channelPattern: readPattern(domestic.channelPattern, d.domestic.channelPattern),
      satellitePattern: readPattern(domestic.satellitePattern, d.domestic.satellitePattern),
      localChannelPattern: readPattern(domestic.localChannelPattern, d.domestic.localChannelPattern),
      genericChannelPattern: readPattern(domestic.genericChannelPattern, d.domestic.genericChannelPattern),
      foreignPattern: readPattern(domestic.foreignPattern, d.domestic.foreignPattern),
      target: readString(domestic.target, d.domestic.target),
    },
    watch: {
      enabled: readBool(watch.enabled, d.watch.enabled),
      groups: readStringArray(watch.groups, d.watch.groups, 500),
      groupPattern: readPattern(watch.groupPattern, d.watch.groupPattern),
      target: readString(watch.target, d.watch.target),
    },
    rotation: {
      enabled: readBool(rotation.enabled, d.rotation.enabled),
      groups: readStringArray(rotation.groups, d.rotation.groups, 500),
      groupPattern: readPattern(rotation.groupPattern, d.rotation.groupPattern),
      target: readString(rotation.target, d.rotation.target),
    },
  };
}

/** 严格校验：管理端提交时使用，非法字段直接拒绝。 */
export function validateBuiltinRuleConfig(input: unknown):
  | { ok: true; config: BuiltinRuleConfig }
  | { ok: false; error: string } {
  if (input == null) return { ok: true, config: normalizeBuiltinRuleConfig(undefined) };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'builtin 必须是对象' };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const radio = (raw.radio || {}) as Record<string, unknown>;
  const local = (raw.local || {}) as Record<string, unknown>;
  const domestic = (raw.domestic || {}) as Record<string, unknown>;
  const watch = (raw.watch || {}) as Record<string, unknown>;
  const rotation = (raw.rotation || {}) as Record<string, unknown>;

  if (typeof radio.enabled !== 'undefined' && typeof radio.enabled !== 'boolean') errors.push('radio.enabled 必须是布尔值');
  for (const key of ['groupPattern', 'groupExcludePattern', 'channelPattern', 'channelExcludePattern']) {
    checkPattern(radio[key], `radio.${key}`, errors);
  }
  checkTarget(radio.target, 'radio.target', errors);

  if (typeof local.enabled !== 'undefined' && typeof local.enabled !== 'boolean') errors.push('local.enabled 必须是布尔值');
  if (!isStringArray(local.provinces, 100)) errors.push('local.provinces 必须是最多 100 个非空字符串');
  if (!isStringArray(local.areaSuffixes, 20)) errors.push('local.areaSuffixes 必须是最多 20 个非空字符串');
  if (!isStringArray(local.municipalities, 20)) errors.push('local.municipalities 必须是最多 20 个非空字符串');
  if (local.aliases != null) {
    if (typeof local.aliases !== 'object' || Array.isArray(local.aliases)) {
      errors.push('local.aliases 必须是对象');
    } else {
      for (const [k, v] of Object.entries(local.aliases as Record<string, unknown>)) {
        if (!isStringArray(v, 50)) errors.push(`local.aliases.${k} 必须是最多 50 个非空字符串`);
      }
    }
  }
  checkPattern(local.provinceLevelBrandPattern, 'local.provinceLevelBrandPattern', errors);
  checkTarget(local.target, 'local.target', errors);
  checkTarget(local.provinceLevelTarget, 'local.provinceLevelTarget', errors);

  if (typeof domestic.enabled !== 'undefined' && typeof domestic.enabled !== 'boolean') errors.push('domestic.enabled 必须是布尔值');
  for (const key of ['groupPattern', 'channelPattern', 'satellitePattern', 'localChannelPattern', 'genericChannelPattern', 'foreignPattern']) {
    checkPattern(domestic[key], `domestic.${key}`, errors);
  }
  if (!isStringArray(domestic.groupExact, 500)) errors.push('domestic.groupExact 必须是最多 500 个非空字符串');
  checkTarget(domestic.target, 'domestic.target', errors);

  for (const [name, rule] of [['watch', watch], ['rotation', rotation]] as const) {
    if (typeof rule.enabled !== 'undefined' && typeof rule.enabled !== 'boolean') errors.push(`${name}.enabled 必须是布尔值`);
    if (!isStringArray(rule.groups, 500)) errors.push(`${name}.groups 必须是最多 500 个非空字符串`);
    checkPattern(rule.groupPattern, `${name}.groupPattern`, errors);
    checkTarget(rule.target, `${name}.target`, errors);
  }

  if (errors.length > 0) return { ok: false, error: errors[0] };
  return { ok: true, config: normalizeBuiltinRuleConfig(input) };
}
