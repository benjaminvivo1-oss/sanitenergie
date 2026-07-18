import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let started = false;

export function initMotion() {
  if (started) return;
  started = true;

  gsap.registerPlugin(ScrollTrigger);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reduceMotion) {
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    lenis.on("scroll", ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    document.documentElement.classList.add("lenis");
  }

  initReveals(reduceMotion);
  initCordeau(reduceMotion);
  initHero(reduceMotion);
  initCounters(reduceMotion);
  initAccordion();
  initSimulator();
}

/* Generic scroll reveals — never the same fade-up twice.
   Each element opts in via data-reveal="up|mask|split|scale" */
function initReveals(reduceMotion: boolean) {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]");

  els.forEach((el, i) => {
    const type = el.dataset.reveal || "up";

    if (reduceMotion) {
      el.classList.add("is-visible");
      el.style.opacity = "1";
      return;
    }

    const delay = Number(el.dataset.revealDelay || 0);

    const fromVars: gsap.TweenVars = { opacity: 0 };
    const toVars: gsap.TweenVars = {
      opacity: 1,
      duration: 0.9,
      delay,
      ease: "power3.out",
    };

    if (type === "up") {
      fromVars.y = 42;
      toVars.y = 0;
    } else if (type === "left") {
      fromVars.x = -48;
      toVars.x = 0;
    } else if (type === "right") {
      fromVars.x = 48;
      toVars.x = 0;
    } else if (type === "scale") {
      fromVars.scale = 0.94;
      toVars.scale = 1;
      toVars.duration = 1.1;
    } else if (type === "mask") {
      el.style.clipPath = "inset(0 0 100% 0)";
      gsap.to(el, {
        clipPath: "inset(0 0 0% 0)",
        opacity: 1,
        duration: 1,
        delay,
        ease: "power4.out",
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          once: true,
        },
      });
      return;
    }

    gsap.fromTo(el, fromVars, {
      ...toVars,
      scrollTrigger: {
        trigger: el,
        start: "top 85%",
        once: true,
      },
    });
  });
}

/* The signature gold cordeau: draws down the page as the reader scrolls,
   and "tightens" (small snap) when the ROI section arrives. */
function initCordeau(reduceMotion: boolean) {
  const track = document.querySelector<HTMLElement>("[data-cordeau-track]");
  const wire = document.querySelector<HTMLElement>(".cordeau__wire");
  const bob = document.querySelector<HTMLElement>(".cordeau__bob");
  if (!track || !wire) return;

  if (reduceMotion) {
    wire.style.transform = "scaleY(1)";
    return;
  }

  gsap.to(wire, {
    scaleY: 1,
    ease: "none",
    scrollTrigger: {
      trigger: track,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.6,
      onUpdate: (self) => {
        if (bob) {
          bob.style.top = `${self.progress * 100}%`;
        }
      },
    },
  });

  const roiTarget = document.querySelector<HTMLElement>("[data-cordeau-snap]");
  if (roiTarget && bob) {
    ScrollTrigger.create({
      trigger: roiTarget,
      start: "top 60%",
      once: true,
      onEnter: () => {
        gsap.fromTo(
          bob,
          { scale: 1 },
          { scale: 1.9, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1 }
        );
      },
    });
  }
}

/* Hero orchestrated entrance: the thesis line reveals like a carpenter's
   pencil mark, then supporting elements settle in sequence. */
function initHero(reduceMotion: boolean) {
  const hero = document.querySelector<HTMLElement>("[data-hero]");
  if (!hero) return;

  const mark = hero.querySelector<HTMLElement>("[data-hero-mark]");
  const words = hero.querySelectorAll<HTMLElement>("[data-hero-word]");
  const rest = hero.querySelectorAll<HTMLElement>("[data-hero-fade]");

  if (reduceMotion) {
    words.forEach((w) => (w.style.opacity = "1"));
    rest.forEach((r) => {
      r.style.opacity = "1";
      r.style.transform = "none";
    });
    return;
  }

  const tl = gsap.timeline({ delay: 0.15 });

  if (mark) {
    tl.set(mark, { clipPath: "inset(0 100% 0 0)" }).to(mark, {
      clipPath: "inset(0 0% 0 0)",
      duration: 1.3,
      ease: "power4.inOut",
    });
  }

  tl.from(
    words,
    {
      opacity: 0,
      y: 18,
      duration: 0.7,
      stagger: 0.09,
      ease: "power3.out",
    },
    mark ? "-=0.5" : 0
  );

  tl.from(
    rest,
    {
      opacity: 0,
      y: 24,
      duration: 0.8,
      stagger: 0.14,
      ease: "power3.out",
    },
    "-=0.25"
  );
}

/* Count-up numbers, fired once when they enter the viewport. */
function initCounters(reduceMotion: boolean) {
  const counters = document.querySelectorAll<HTMLElement>("[data-counter]");

  counters.forEach((el) => {
    const target = Number(el.dataset.counter || "0");
    const suffix = el.dataset.counterSuffix || "";
    const prefix = el.dataset.counterPrefix || "";
    const decimals = Number(el.dataset.counterDecimals || "0");

    if (reduceMotion) {
      el.textContent = `${prefix}${target.toLocaleString("fr-FR")}${suffix}`;
      return;
    }

    const obj = { val: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: "top 85%",
      once: true,
      onEnter: () => {
        gsap.to(obj, {
          val: target,
          duration: 1.6,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = `${prefix}${obj.val.toLocaleString("fr-FR", {
              maximumFractionDigits: decimals,
              minimumFractionDigits: decimals,
            })}${suffix}`;
          },
        });
      },
    });
  });
}

/* FAQ accordion — simple, accessible, no external lib. */
function initAccordion() {
  const items = document.querySelectorAll<HTMLElement>("[data-faq-item]");
  items.forEach((item) => {
    const btn = item.querySelector<HTMLButtonElement>("[data-faq-trigger]");
    const panel = item.querySelector<HTMLElement>("[data-faq-panel]");
    if (!btn || !panel) return;

    btn.addEventListener("click", () => {
      const isOpen = item.getAttribute("data-open") === "true";
      items.forEach((other) => {
        other.setAttribute("data-open", "false");
        const otherBtn = other.querySelector<HTMLButtonElement>("[data-faq-trigger]");
        const otherPanel = other.querySelector<HTMLElement>("[data-faq-panel]");
        otherBtn?.setAttribute("aria-expanded", "false");
        if (otherPanel) otherPanel.style.maxHeight = "0px";
      });

      if (!isOpen) {
        item.setAttribute("data-open", "true");
        btn.setAttribute("aria-expanded", "true");
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      }
    });
  });
}

/* ROI mini-simulator: slider (devis/mois) -> montant récupéré / seuil de rentabilité. */
function initSimulator() {
  const root = document.querySelector<HTMLElement>("[data-simulator]");
  if (!root) return;

  const slider = root.querySelector<HTMLInputElement>("[data-sim-slider]");
  const devisOut = root.querySelector<HTMLElement>("[data-sim-devis]");
  const recoveredOut = root.querySelector<HTMLElement>("[data-sim-recovered]");
  const sliderFill = root.querySelector<HTMLElement>("[data-sim-fill]");
  if (!slider || !devisOut || !recoveredOut) return;

  const AVG_QUOTE_VALUE = 1450; // valeur moyenne d'un devis BTP, placeholder raisonnable
  const RECOVERY_RATE = 0.22; // part de devis relancés qui se transforment grâce à la relance auto

  const compute = () => {
    const devisPerMonth = Number(slider.value);
    const recovered = Math.round(devisPerMonth * AVG_QUOTE_VALUE * RECOVERY_RATE);

    devisOut.textContent = String(devisPerMonth);
    recoveredOut.textContent = recovered.toLocaleString("fr-FR");

    if (sliderFill) {
      const pct = ((devisPerMonth - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
      sliderFill.style.width = `${pct}%`;
    }
  };

  slider.addEventListener("input", compute);
  compute();
}
