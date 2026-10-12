import type { AstroInstance } from 'astro';

export interface SocialLink {
	name: string;
	url: string;
	icon: AstroInstance;
}

export default {
	title: 'JK',
	favicon: 'favicon.ico',
	owner: 'June Kim',
	profileImage: 'profile.webp',
	socialLinks: [] as SocialLink[],
};
