import { useEffect } from 'react';

export interface SeoProps {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
  keywords?: string[];
  noIndex?: boolean;
  type?: 'website' | 'book' | 'article';
  jsonLd?: Record<string, unknown>;
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

/** Client-side SEO head management. Server-rendered metadata arrives with the real backend. */
export function Seo({ title, description, canonical, image, keywords, noIndex, type = 'website', jsonLd }: SeoProps) {
  useEffect(() => {
    const fullTitle = title.includes('Scriptora') ? title : `${title} · Scriptora`;
    document.title = fullTitle;
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:type', type);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', fullTitle);

    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
      setMeta('name', 'twitter:description', description);
    }
    if (image) {
      setMeta('property', 'og:image', image);
      setMeta('name', 'twitter:image', image);
    }
    if (keywords?.length) setMeta('name', 'keywords', keywords.join(', '));
    setMeta('name', 'robots', noIndex ? 'noindex,nofollow' : 'index,follow');

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = canonical.startsWith('http') ? canonical : `${window.location.origin}${canonical}`;
    }

    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.getElementById('scriptora-jsonld') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'scriptora-jsonld';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    }
    return () => {
      if (script) script.remove();
    };
  }, [title, description, canonical, image, keywords, noIndex, type, jsonLd]);

  return null;
}
