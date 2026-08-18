// /coverage rail controls + creator-index scrollspy. Pure progressive
// enhancement: the rails are plain horizontal scroll containers that work
// fully without any of this — here we only reveal the desktop ‹ › buttons
// when a rail actually overflows, and highlight the creator index chip for
// the section in view. Re-runs on every astro:page-load (view-transition
// navigation included); all listeners are attached to elements that die with
// the page, so re-running never stacks live listeners.

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function initRail(rail: HTMLElement): void {
  const section = rail.closest("section");
  const controls = section?.querySelector<HTMLElement>(".cov-rail-controls");
  const prev = section?.querySelector<HTMLButtonElement>("[data-rail-prev]");
  const next = section?.querySelector<HTMLButtonElement>("[data-rail-next]");
  if (!controls || !prev || !next) return;

  const overflows = rail.scrollWidth > rail.clientWidth + 4;
  controls.hidden = !overflows;
  if (!overflows) return;

  const update = () => {
    const max = rail.scrollWidth - rail.clientWidth - 1;
    prev.disabled = rail.scrollLeft <= 1;
    next.disabled = rail.scrollLeft >= max;
  };

  const step = (direction: -1 | 1) => {
    rail.scrollBy({
      left: direction * rail.clientWidth * 0.85,
      behavior: window.matchMedia(REDUCED_MOTION).matches ? "auto" : "smooth",
    });
  };

  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  rail.addEventListener("scroll", update, { passive: true });
  update();
}

// Highlights the index chip of whichever creator section is currently on
// screen. rootMargin pushes the observation band below the sticky chrome and
// keeps it shallow so exactly one section tends to match at a time.
function initScrollspy(): void {
  const chips = document.querySelectorAll<HTMLAnchorElement>(".cov-index a[href^='#']");
  if (chips.length === 0) return;

  const byId = new Map<string, HTMLAnchorElement>();
  for (const chip of chips) {
    byId.set(decodeURIComponent(chip.hash.slice(1)), chip);
  }

  const sections = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null);
  if (sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const chip of chips) chip.removeAttribute("aria-current");
        byId.get(entry.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  for (const section of sections) observer.observe(section);
}

function initCoverage(): void {
  const rails = document.querySelectorAll<HTMLElement>("[data-rail]");
  if (rails.length === 0) return; // not on /coverage
  rails.forEach(initRail);
  initScrollspy();
}

document.addEventListener("astro:page-load", initCoverage);
