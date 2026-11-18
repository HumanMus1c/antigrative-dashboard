// Read only whitelisted theme/font settings; never expose the customization config.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {platformPaths} from './platform.mjs';
const theme=createRequire(import.meta.url)('./theme.cjs')();
function resolveConfigFont(settings,keys) {
  for(const key of keys){if(typeof settings?.[key]==='string'&&settings[key].trim())return settings[key];}
  return undefined;
}

export async function readHostTheme({file=platformPaths().pluginConfig,read=readFile}={}) {
  try {
    const text=await read(file,'utf8');if(text.length>1048576)return {};
    const settings=JSON.parse(text.replace(/^\uFEFF/,''))?.userSettings;
    const mode={THEME_MODE_DARK:'dark',THEME_MODE_LIGHT:'light',THEME_MODE_SYSTEM:'system',dark:'dark',light:'light',system:'system'}[settings?.themeMode];
    const fontFamily=resolveConfigFont(settings,['fontFamily','uiFontFamily','appearanceFont','appearanceFontFamily','customFontFamily','font'])
      ||resolveConfigFont(settings?.appearance,['fontFamily','uiFontFamily','font']);
    const monoFontFamily=resolveConfigFont(settings,['monoFontFamily','editorFontFamily','codeFontFamily','monospaceFontFamily'])
      ||resolveConfigFont(settings?.appearance,['monoFontFamily','editorFontFamily','codeFontFamily']);
    return theme.normalizeHostTheme({mode,dark:settings?.customThemeSeedsDark,light:settings?.customThemeSeedsLight,fontFamily,monoFontFamily});
  }catch{return {};}
}
