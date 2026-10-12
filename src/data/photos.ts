import { getImage } from 'astro:assets';
import type { Collection, Image } from './galleryData';
import { featuredCollectionId } from './imageStore';

/** A photo prepared for rendering: optimised URLs, sizes and display captions. */
export interface Photo {
	title: string;
	description: string;
	/** Display name of the first real collection the photo belongs to. */
	sub: string;
	collectionIds: string[];
	width: number;
	height: number;
	ratio: number;
	/** Optimised URL used for grid tiles. */
	thumb: string;
	/** Responsive source set for the given widths. */
	srcset: string;
	/** Largest optimised URL, used by the lightbox. */
	full: string;
}

interface PrepareOptions {
	/** Candidate widths for the srcset (clamped to the source width, never upscaled). */
	widths: number[];
	/** Width of the `thumb` URL. */
	thumbWidth: number;
	/** Width of the `full` URL. */
	fullWidth: number;
}

const clampWidths = (widths: number[], max: number): number[] =>
	[...new Set(widths.map((w) => Math.min(w, max)))].sort((a, b) => a - b);

const optimised = async (image: Image, width: number) => {
	const result = await getImage({
		src: image.src,
		width: Math.min(width, image.src.width),
		format: 'webp',
		quality: 82,
	});
	return result.src;
};

export const preparePhotos = async (
	images: Image[],
	collections: Collection[],
	options: PrepareOptions,
): Promise<Photo[]> => {
	const names = new Map(collections.map((c) => [c.id, c.name]));
	return Promise.all(
		images.map(async (image) => {
			const { width, height } = image.src;
			const ids = image.collections.filter((id) => id !== featuredCollectionId);
			const widths = clampWidths(options.widths, width);
			const urls = await Promise.all(widths.map((w) => optimised(image, w)));
			return {
				title: image.title,
				description: image.description,
				sub: ids.length ? (names.get(ids[0]) ?? ids[0]) : '',
				collectionIds: ids,
				width,
				height,
				ratio: width / height,
				thumb: await optimised(image, options.thumbWidth),
				srcset: urls.map((url, i) => `${url} ${widths[i]}w`).join(', '),
				full: await optimised(image, options.fullWidth),
			};
		}),
	);
};
