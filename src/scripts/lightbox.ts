/**
 * Full-screen photo viewer. A photo grows out of its thumbnail to fill the screen
 * (FLIP animation), and shrinks back into it on close. No page navigation involved.
 */

interface Item {
	trigger: HTMLElement;
	img: HTMLImageElement | null;
	full: string;
	width: number;
	height: number;
	title: string;
	sub: string;
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const IDLE_MS = 2600;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let root: HTMLElement | null = null;
let imgEl: HTMLImageElement;
let titleEl: HTMLElement;
let subEl: HTMLElement;
let numEl: HTMLElement;
let prevBtn: HTMLButtonElement;
let nextBtn: HTMLButtonElement;
let closeBtn: HTMLButtonElement;

let items: Item[] = [];
let index = -1;
let isOpen = false;
let busy = false;
let opener: HTMLElement | null = null;
let idleTimer = 0;
let runningAnims: Animation[] = [];

const ICON = {
	close:
		'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>',
	prev: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
	next: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>',
};

const button = (cls: string, label: string, icon: string) => {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = `lb-btn ${cls}`;
	b.setAttribute('aria-label', label);
	b.innerHTML = icon;
	return b;
};

function build() {
	root = document.createElement('div');
	root.className = 'lb';
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-modal', 'true');
	root.setAttribute('aria-label', 'Photo viewer');

	const bg = document.createElement('div');
	bg.className = 'lb-bg';

	imgEl = document.createElement('img');
	imgEl.className = 'lb-img';
	imgEl.alt = '';
	imgEl.draggable = false;

	const cap = document.createElement('div');
	cap.className = 'lb-cap';
	titleEl = document.createElement('b');
	subEl = document.createElement('span');
	numEl = document.createElement('span');
	numEl.className = 'num';
	cap.append(titleEl, subEl, numEl);

	closeBtn = button('lb-close', 'Close', ICON.close);
	prevBtn = button('lb-prev', 'Previous photo', ICON.prev);
	nextBtn = button('lb-next', 'Next photo', ICON.next);

	root.append(bg, imgEl, cap, closeBtn, prevBtn, nextBtn);
	document.body.append(root);

	bg.addEventListener('click', () => close());
	closeBtn.addEventListener('click', () => close());
	prevBtn.addEventListener('click', () => go(-1));
	nextBtn.addEventListener('click', () => go(1));
	imgEl.addEventListener('click', (e) => {
		e.stopPropagation();
		close();
	});

	// Swipe left/right to move between photos.
	let startX = 0;
	let startY = 0;
	root.addEventListener('pointerdown', (e) => {
		startX = e.clientX;
		startY = e.clientY;
	});
	root.addEventListener('pointerup', (e) => {
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (e.pointerType === 'mouse') return;
		if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
		else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4) close();
	});
	root.addEventListener('pointermove', wake);
}

/** Fit a photo inside the screen with almost no margin so it fills as much as possible. */
function targetBox(width: number, height: number): Box {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const narrow = vw < 700;
	const padX = narrow ? 8 : 28;
	const padTop = narrow ? 56 : 24;
	const padBottom = narrow ? 64 : 60;
	const scale = Math.min((vw - padX * 2) / width, (vh - padTop - padBottom) / height);
	const w = width * scale;
	const h = height * scale;
	return {
		left: (vw - w) / 2,
		top: padTop + (vh - padTop - padBottom - h) / 2,
		width: w,
		height: h,
	};
}

const place = (box: Box) => {
	imgEl.style.left = `${box.left}px`;
	imgEl.style.top = `${box.top}px`;
	imgEl.style.width = `${box.width}px`;
	imgEl.style.height = `${box.height}px`;
};

const delta = (from: Box, to: Box) =>
	`translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;

const sourceBox = (item: Item): Box | null => {
	const el = item.img ?? item.trigger;
	const r = el.getBoundingClientRect();
	const onScreen =
		r.width > 0 &&
		r.bottom > 0 &&
		r.top < window.innerHeight &&
		r.right > 0 &&
		r.left < window.innerWidth;
	return onScreen ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
};

function play(frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
	const anim = imgEl.animate(frames, options);
	runningAnims.push(anim);
	return anim.finished.then(
		() => undefined,
		() => undefined,
	);
}

const stopAnims = () => {
	runningAnims.forEach((a) => a.cancel());
	runningAnims = [];
};

function collect(): Item[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-lightbox]'))
		.filter((el) => !el.hidden && el.getClientRects().length > 0)
		.map((el) => ({
			trigger: el,
			img: el.querySelector('img'),
			full: el.dataset.full ?? (el as HTMLAnchorElement).href,
			width: Number(el.dataset.w) || 1,
			height: Number(el.dataset.h) || 1,
			title: el.dataset.title ?? '',
			sub: el.dataset.sub ?? '',
		}));
}

function setCaption() {
	const item = items[index];
	titleEl.textContent = item.title;
	subEl.textContent = item.sub;
	numEl.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
	prevBtn.disabled = index <= 0;
	nextBtn.disabled = index >= items.length - 1;
}

/** Show the thumbnail instantly, then swap to the full-size file once decoded. */
function load(item: Item) {
	const thumb = item.img?.currentSrc || item.img?.src || item.full;
	imgEl.alt = item.title;
	imgEl.src = thumb;
	if (thumb !== item.full) {
		const hi = new Image();
		hi.src = item.full;
		hi.decode().then(
			() => {
				if (items[index] === item) imgEl.src = item.full;
			},
			() => undefined,
		);
	}
}

function preloadNeighbours() {
	[index - 1, index + 1].forEach((i) => {
		if (items[i]) new Image().src = items[i].full;
	});
}

const hideSource = (item: Item, hidden: boolean) => {
	if (item.img) item.img.style.visibility = hidden ? 'hidden' : '';
};

async function open(trigger: HTMLElement) {
	if (isOpen || busy) return;
	items = collect();
	index = items.findIndex((i) => i.trigger === trigger);
	if (index < 0) return;
	if (!root?.isConnected) build();

	busy = true;
	isOpen = true;
	opener = trigger;
	const item = items[index];
	const from = sourceBox(item);
	const to = targetBox(item.width, item.height);

	document.documentElement.style.overflow = 'hidden';
	root!.setAttribute('data-open', '');
	place(to);
	load(item);
	setCaption();
	preloadNeighbours();
	hideSource(item, true);
	void root!.offsetWidth; // flush so the transitions below start from the hidden state
	root!.setAttribute('data-show', '');
	closeBtn.focus({ preventScroll: true });
	wake();

	if (from && !reduced()) {
		await play([{ transform: delta(from, to) }, { transform: 'none' }], {
			duration: 640,
			easing: SPRING,
		});
	} else {
		await play([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: OUT });
	}
	stopAnims();
	busy = false;
}

async function close() {
	if (!isOpen || busy) return;
	busy = true;
	window.clearTimeout(idleTimer);
	root!.removeAttribute('data-idle');
	root!.removeAttribute('data-show');

	const item = items[index];
	const to = targetBox(item.width, item.height);
	const back = sourceBox(item);
	if (back && !reduced()) {
		await play([{ transform: 'none' }, { transform: delta(back, to) }], {
			duration: 520,
			easing: SPRING,
			fill: 'forwards',
		});
	} else {
		await play([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: OUT, fill: 'forwards' });
	}
	hideSource(item, false);
	stopAnims();
	root!.removeAttribute('data-open');
	document.documentElement.style.overflow = '';
	isOpen = false;
	busy = false;
	opener?.focus({ preventScroll: true });
	opener = null;
}

async function go(step: number) {
	const next = index + step;
	if (!isOpen || busy || next < 0 || next >= items.length) return;
	busy = true;
	const leaving = items[index];
	const arriving = items[next];
	const dir = step > 0 ? 1 : -1;

	if (!reduced()) {
		await play(
			[
				{ transform: 'none', opacity: 1 },
				{ transform: `translateX(${-dir * 56}px)`, opacity: 0 },
			],
			{
				duration: 240,
				easing: 'cubic-bezier(0.4, 0, 1, 1)',
				fill: 'forwards',
			},
		);
	}
	stopAnims();
	hideSource(leaving, false);
	index = next;
	hideSource(arriving, true);
	place(targetBox(arriving.width, arriving.height));
	load(arriving);
	setCaption();
	preloadNeighbours();
	if (!reduced()) {
		await play(
			[
				{ transform: `translateX(${dir * 56}px)`, opacity: 0 },
				{ transform: 'none', opacity: 1 },
			],
			{
				duration: 560,
				easing: OUT,
			},
		);
	}
	stopAnims();
	busy = false;
}

/** Chrome (buttons, caption, cursor) fades away when the pointer rests, leaving only the photo. */
function wake() {
	if (!root) return;
	root.removeAttribute('data-idle');
	window.clearTimeout(idleTimer);
	idleTimer = window.setTimeout(() => root?.setAttribute('data-idle', ''), IDLE_MS);
}

function onKey(e: KeyboardEvent) {
	if (!isOpen) return;
	wake();
	if (e.key === 'Escape') close();
	else if (e.key === 'ArrowRight') go(1);
	else if (e.key === 'ArrowLeft') go(-1);
	else if (e.key === 'Tab') {
		const focusable = [closeBtn, prevBtn, nextBtn].filter((b) => !b.disabled);
		const i = focusable.indexOf(document.activeElement as HTMLButtonElement);
		e.preventDefault();
		focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
	}
}

function onResize() {
	if (!isOpen || busy) return;
	const item = items[index];
	place(targetBox(item.width, item.height));
}

export function initLightbox() {
	const w = window as unknown as { __lightbox?: boolean };
	if (w.__lightbox) return;
	w.__lightbox = true;

	// Capture phase on window: this must run before the client-side router sees the link click,
	// otherwise it would try to "navigate" to the image file.
	window.addEventListener(
		'click',
		(e) => {
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			const trigger = (e.target as Element).closest<HTMLElement>('[data-lightbox]');
			if (!trigger) return;
			e.preventDefault();
			e.stopPropagation();
			open(trigger);
		},
		true,
	);
	document.addEventListener('keydown', onKey);
	window.addEventListener('resize', onResize);
	// A client-side page change must never leave the viewer (and the scroll lock) behind.
	document.addEventListener('astro:before-swap', () => {
		if (!isOpen) return;
		stopAnims();
		hideSource(items[index], false);
		root?.removeAttribute('data-open');
		root?.removeAttribute('data-show');
		document.documentElement.style.overflow = '';
		isOpen = false;
		busy = false;
	});
}
