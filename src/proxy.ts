/**
 * Proxy support for Anthropic API requests.
 *
 * When proxy environment variables are set, routes requests through the proxy
 * using undici's ProxyAgent. Respects NO_PROXY/no_proxy for bypass lists and
 * NODE_TLS_REJECT_UNAUTHORIZED for TLS verification.
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';

/**
 * Get the proxy URL from environment variables.
 * Checks HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy.
 */
export function getProxyUrl(): string | undefined {
    return (
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        undefined
    );
}

/**
 * Read TLS strict mode. Returns false only when NODE_TLS_REJECT_UNAUTHORIZED
 * is explicitly set to '0'.
 */
export function getStrictSSL(): boolean {
    return process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';
}

/**
 * Check whether a target URL should bypass the proxy based on NO_PROXY / no_proxy.
 */
export function isProxyBypassed(targetUrl: string): boolean {
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (!noProxy) {
        return false;
    }

    let hostname: string;
    try {
        hostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {
        return false;
    }

    const entries = noProxy.split(',').map((e) => e.trim().toLowerCase());
    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        if (entry === '*') {
            return true;
        }
        if (hostname === entry) {
            return true;
        }
        const suffix = entry.startsWith('.') ? entry : `.${entry}`;
        if (hostname.endsWith(suffix)) {
            return true;
        }
    }
    return false;
}

/**
 * Create a fetch implementation that routes requests through an HTTP(S) proxy.
 * Respects TLS verification settings and NO_PROXY bypass lists.
 *
 * @param proxyUrl - The proxy URL (e.g. https://proxy.example.com:8080)
 * @returns A fetch function that uses ProxyAgent as the dispatcher
 */
export function createProxyFetch(proxyUrl: string): typeof fetch {
    const proxyAgent = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: getStrictSSL() },
    });
    return ((input: any, init?: any) => {
        const targetUrl = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        if (isProxyBypassed(targetUrl)) {
            return undiciFetch(input, init);
        }
        return undiciFetch(input, { ...init, dispatcher: proxyAgent });
    }) as any;
}
