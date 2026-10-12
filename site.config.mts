import type { AstroInstance } from 'astro';

export interface SocialLink {
	name: string;
	url: string;
	icon: AstroInstance;
}

export default {
	title: 'pareiidoliaaa',
	favicon: 'favicon.ico',
	owner: 'pareiidoliaaa',
	profileImage: 'profile.webp',
	socialLinks: [] as SocialLink[],
};
