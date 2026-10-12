import { initLightbox } from './lightbox';

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const $$ = <T extends Element>(sel: string, scope: ParentNode = document) =>
	Array.from(scope.querySelectorAll<T>(sel));

/* ───────── reveal on enter ───────── */

let revealObserver: IntersectionObserver | null = null;

function initReveal() {
	revealObserver?.disconnect();
	const targets = $$<HTMLElement>('[data-reveal]:not(.in)');
	if (reduced()) {
		targets.forEach((el) => el.classList.add('in'));
		return;
	}
	revealObserver = new IntersectionObserver(
		(entries) => {
			// Everything that arrives in the same frame is staggered top-to-bottom, left-to-right.
			const arriving = entries
				.filter((e) => e.isIntersecting)
				.sort(
					(a, b) =>
						a.boundingClientRect.top - b.boundingClientRect.top ||
						a.boundingClientRect.left - b.boundingClientRect.left,
				);
			arriving.forEach((entry, i) => {
				const el = entry.target as HTMLElement;
				el.style.setProperty('--d', `${Math.min(i * 70, 420)}ms`);
				el.classList.add('in');
				revealObserver?.unobserve(el);
			});
		},
		{ rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
	);
	targets.forEach((el) => revealObserver!.observe(el));
}

/* ───────── images fade in once decoded ───────── */

function initImages() {
	$$<HTMLImageElement>('img[data-fade]').forEach((img) => {
		if (img.classList.contains('is-loaded')) return;
		const done = () => img.classList.add('is-loaded');
		if (img.complete && img.naturalWidth > 0) requestAnimationFrame(done);
		else {
			img.addEventListener('load', done, { once: true });
			img.addEventListener('error', done, { once: true });
		}
	});
}

/* ───────── navigation indicator ───────── */

let onNavResize: (() => void) | null = null;

const normalise = (path: string) => path.replace(/\/+$/, '') || '/';

function initNav() {
	const menu = document.querySelector<HTMLElement>('.menu');
	if (!menu) return;
	const links = $$<HTMLAnchorElement>('a', menu);
	const here = normalise(location.pathname);
	const pathOf = (a: HTMLAnchorElement) => normalise(new URL(a.href).pathname);
	const current =
		links.find((a) => pathOf(a) === here) ??
		links
			.filter((a) => !a.hasAttribute('data-home') && here.startsWith(`${pathOf(a)}/`))
			.sort((a, b) => pathOf(b).length - pathOf(a).length)[0] ??
		null;
	links.forEach((a) => a.removeAttribute('aria-current'));
	current?.setAttribute('aria-current', 'page');

	const place = () => {
		if (!current) return;
		menu.style.setProperty('--x', `${current.offsetLeft}px`);
		menu.style.setProperty('--w', `${current.offsetWidth}px`);
	};
	place();
	if (!menu.hasAttribute('data-ready')) {
		requestAnimationFrame(() => requestAnimationFrame(() => menu.setAttribute('data-ready', '')));
	}
	document.fonts?.ready.then(place);
	if (onNavResize) window.removeEventListener('resize', onNavResize);
	onNavResize = place;
	window.addEventListener('resize', place, { passive: true });
}

/* ───────── scroll driven scenes (best photos) ───────── */

interface Scene {
	el: HTMLElement;
	shot: HTMLElement;
	caption: HTMLElement | null;
}

let scenes: Scene[] = [];
let dots: HTMLButtonElement[] = [];
let ticking = false;
let activeScene = -1;

function updateScenes() {
	ticking = false;
	if (!scenes.length) return;
	const vh = window.innerHeight;
	const still = reduced();
	let nearest = 0;
	let nearestDist = Infinity;

	scenes.forEach((scene, i) => {
		const r = scene.el.getBoundingClientRect();
		const centre = r.top + r.height / 2;
		const d = (centre - vh / 2) / (vh / 2 + r.height / 2); // 0 when centred, ±1 when fully off screen
		const a = Math.abs(d);
		if (a < nearestDist) {
			nearestDist = a;
			nearest = i;
		}
		if (still || a > 1.05) return;
		// A dead zone keeps the photo perfectly still and sharp while it owns the screen.
		const e = clamp((a - 0.12) / 0.88);
		const ease = e * e * (3 - 2 * e);
		scene.shot.style.transform = `translate3d(0, ${(-d * 34).toFixed(1)}px, 0) scale(${(1 - 0.075 * ease).toFixed(4)})`;
		scene.shot.style.opacity = String(clamp(1 - 0.92 * ease ** 1.25).toFixed(3));
		if (scene.caption) {
			scene.caption.style.transform = `translate3d(0, ${(-d * 70).toFixed(1)}px, 0)`;
			scene.caption.style.opacity = String(clamp(1 - 1.6 * clamp((a - 0.2) / 0.8)).toFixed(3));
		}
	});

	if (nearest !== activeScene) {
		activeScene = nearest;
		dots.forEach((d, i) => d.setAttribute('aria-current', String(i === nearest)));
	}
}

const requestUpdate = () => {
	if (!ticking) {
		ticking = true;
		requestAnimationFrame(updateScenes);
	}
};

function initScenes() {
	scenes = $$<HTMLElement>('.scene').map((el) => ({
		el,
		shot: el.querySelector<HTMLElement>('.shot')!,
		caption: el.querySelector<HTMLElement>('.caption'),
	}));
	dots = $$<HTMLButtonElement>('.dots button');
	activeScene = -1;
	dots.forEach((dot, i) =>
		dot.addEventListener('click', () =>
			scenes[i]?.el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }),
		),
	);
	updateScenes();
}

/* ───────── theme toggle with a circular reveal ───────── */

async function toggleTheme(button: HTMLElement) {
	const root = document.documentElement;
	const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
	const apply = () => {
		root.dataset.theme = next;
		try {
			localStorage.setItem('theme', next);
		} catch {
			/* storage may be unavailable */
		}
	};
	const doc = document as Document & {
		startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
	};
	if (!doc.startViewTransition || reduced()) return apply();

	const r = button.getBoundingClientRect();
	const x = r.left + r.width / 2;
	const y = r.top + r.height / 2;
	const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
	root.setAttribute('data-theme-switch', '');
	const transition = doc.startViewTransition(apply);
	try {
		await transition.ready;
		root.animate(
			{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
			{ duration: 750, easing: OUT, pseudoElement: '::view-transition-new(root)' },
		);
		await transition.finished;
	} finally {
		root.removeAttribute('data-theme-switch');
	}
}

/* ───────── gallery filter with FLIP re-layout ───────── */

let filterBusy = false;

function placeThumb(seg: HTMLElement) {
	const active = seg.querySelector<HTMLElement>('button[aria-pressed="true"]');
	if (!active) return;
	seg.style.setProperty('--x', `${active.offsetLeft}px`);
	seg.style.setProperty('--w', `${active.offsetWidth}px`);
}

async function applyFilter(grid: HTMLElement, id: string, animate: boolean) {
	const tiles = $$<HTMLElement>('.tile', grid);
	const matches = (t: HTMLElement) =>
		id === 'all' || (t.dataset.collections ?? '').split(' ').includes(id);
	const visible = tiles.filter((t) => !t.hidden);
	const first = new Map(visible.map((t) => [t, t.getBoundingClientRect()]));
	const leaving = visible.filter((t) => !matches(t));
	const entering = tiles.filter((t) => t.hidden && matches(t));

	const count = document.querySelector('[data-count]');
	const total = tiles.filter(matches).length;
	if (count) count.textContent = `${total} ${total === 1 ? 'photograph' : 'photographs'}`;

	if (!animate || reduced()) {
		tiles.forEach((t) => {
			t.hidden = !matches(t);
			if (!t.hidden) t.classList.add('in');
		});
		return;
	}

	filterBusy = true;
	const fades = leaving.map((t) =>
		t.animate(
			[
				{ opacity: 1, transform: 'scale(1)' },
				{ opacity: 0, transform: 'scale(0.94)' },
			],
			{ duration: 240, easing: 'ease-out', fill: 'forwards' },
		),
	);
	await Promise.all(fades.map((a) => a.finished.catch(() => undefined)));
	leaving.forEach((t) => (t.hidden = true));
	fades.forEach((a) => a.cancel());
	entering.forEach((t) => {
		t.hidden = false;
		t.classList.add('in');
	});

	tiles
		.filter((t) => first.has(t) && !t.hidden)
		.forEach((t) => {
			const f = first.get(t)!;
			const l = t.getBoundingClientRect();
			t.animate(
				[
					{
						transformOrigin: '0 0',
						transform: `translate(${f.left - l.left}px, ${f.top - l.top}px) scale(${f.width / l.width}, ${f.height / l.height})`,
					},
					{ transformOrigin: '0 0', transform: 'none' },
				],
				{ duration: 720, easing: SPRING },
			);
		});
	entering.forEach((t, i) =>
		t.animate(
			[
				{ opacity: 0, transform: 'translateY(18px) scale(0.97)' },
				{ opacity: 1, transform: 'none' },
			],
			{ duration: 800, delay: 160 + i * 45, easing: OUT, fill: 'backwards' },
		),
	);
	window.setTimeout(() => (filterBusy = false), 360);
}

let onGalleryResize: (() => void) | null = null;

function initGallery() {
	const grid = document.querySelector<HTMLElement>('.grid');
	const seg = document.querySelector<HTMLElement>('.seg');
	if (!grid || !seg) return;
	const buttons = $$<HTMLButtonElement>('button', seg);
	const select = (id: string) => {
		buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === id)));
		placeThumb(seg);
	};

	const fromHash = decodeURIComponent(location.hash.slice(1));
	const initial = buttons.some((b) => b.dataset.filter === fromHash) ? fromHash : 'all';
	select(initial);
	if (initial !== 'all') applyFilter(grid, initial, false);
	if (!seg.hasAttribute('data-ready'))
		requestAnimationFrame(() => requestAnimationFrame(() => seg.setAttribute('data-ready', '')));
	document.fonts?.ready.then(() => placeThumb(seg));
	if (onGalleryResize) window.removeEventListener('resize', onGalleryResize);
	onGalleryResize = () => placeThumb(seg);
	window.addEventListener('resize', onGalleryResize, { passive: true });

	buttons.forEach((b) =>
		b.addEventListener('click', () => {
			const id = b.dataset.filter ?? 'all';
			if (filterBusy || b.getAttribute('aria-pressed') === 'true') return;
			select(id);
			history.replaceState(null, '', id === 'all' ? location.pathname + location.search : `#${id}`);
			applyFilter(grid, id, true);
		}),
	);
}

/* ───────── boot ───────── */

let bound = false;

function bindOnce() {
	if (bound) return;
	bound = true;
	initLightbox();
	window.addEventListener(
		'scroll',
		() => {
			document.documentElement.toggleAttribute('data-scrolled', window.scrollY > 8);
			requestUpdate();
		},
		{ passive: true },
	);
	window.addEventListener('resize', requestUpdate, { passive: true });
	document.addEventListener('click', (e) => {
		const btn = (e.target as Element).closest<HTMLElement>('[data-theme-toggle]');
		if (btn) toggleTheme(btn);
	});
}

function boot() {
	bindOnce();
	document.documentElement.toggleAttribute('data-scrolled', window.scrollY > 8);
	initNav();
	initImages();
	initScenes();
	initGallery();
	initReveal();
}

document.addEventListener('astro:page-load', boot);
