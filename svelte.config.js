import adapter from '@sveltejs/adapter-node';

export default {
  kit: {
    /**
     * 缺省输出必须不是 'build'：那是桌面端 / 手动构建以外的目录，裸跑 `vite build` 不该覆盖谁正在用的产物。
     * 桌面端构建（desktop/build.js）显式用 BUILD_OUT 指到 desktop/.stage/app/build。
     */
    adapter: adapter({ out: process.env.BUILD_OUT || 'build.dev' }),
    alias: { $lib: 'src/lib' },
    /** 服务端 /_app/version.json 轮询：发版后旧窗口下一次跳转走整页加载，免得旧路由表装错页面 */
    version: { pollInterval: 300_000 },
    /** 本机服务不需要 service worker */
    serviceWorker: { register: false }
  }
};
