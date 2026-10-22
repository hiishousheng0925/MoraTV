import { handleStream } from '$lib/server/stream/proxy.js';

/**
 * GET /api/stream?u=<m3u8 地址> -> 去广告、改写后的 playlist（application/vnd.apple.mpegurl，响应头 X-Ads-Removed）
 * GET /api/stream?u=<密钥地址>&kind=key -> 密钥原样（二进制）
 * 内网地址 403、上游失败 502。实现见 $lib/server/stream/proxy.js。
 */
export const GET = ({ url }) => handleStream(url.searchParams);
