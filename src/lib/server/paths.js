/**
 * 数据目录的唯一来源（别处一律从这里 import，不要自己拼路径）。
 *
 * 不靠 import.meta.url 推算：生产构建（adapter-node）会把本文件打进 build/server/chunks/ 下，相对路径全错；
 * node:sqlite 打不开时还会「静默新建一个空库」。
 *
 * MORA_HOME 缺省 %APPDATA%\MoraTV；测试一律把它指到临时目录。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const defaultHome = () => join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'MoraTV');

export const HOME = resolve(process.env.MORA_HOME || defaultHome());
export const DATA_DIR = join(HOME, 'data');
export const DB_PATH = join(DATA_DIR, 'moratv.db');
export const CACHE_DIR = join(HOME, 'cache');
