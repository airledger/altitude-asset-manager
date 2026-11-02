// Air Ledger marketing site. No framework, no cookies.
(function () {
  // Live Supabase project. The anon key is public by design; the waiting list
  // can only be written to through the join_waitlist function, never read.
  var SUPABASE_URL = "https://txtdydgflwvzxjrfdbly.supabase.co";
  var SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4dGR5ZGdmbHd2enhqcmZkYmx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNTc0NzgsImV4cCI6MjEwODkzMzQ3OH0.LzVn0QCn0tJqsFZOcGFH1aZrihhNLYOW018FC8KGPm4";

  // Nav turns solid once you scroll past the top.
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("solid", window.scrollY > 30); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Fade sections in as they come into view.
  var targets = document.querySelectorAll(".reason, .steps li, .plan, .split > *, .faq details, .founder");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -60px 0px" });
    targets.forEach(function (el, i) {
      el.classList.add("rv");
      el.style.transitionDelay = (i % 4) * 80 + "ms";
      io.observe(el);
    });
  }

  // Monthly / yearly price toggle.
  var toggle = document.querySelector(".toggle");
  toggle.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var yearly = btn.dataset.period === "y";
    toggle.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === btn); });
    document.querySelectorAll(".price").forEach(function (p) {
      p.querySelector(".amt").textContent = "£" + (yearly ? p.dataset.y : p.dataset.m);
      p.querySelector(".per").textContent = yearly ? "/year" : "/month";
    });
  });

  // Waiting list.
  var form = document.getElementById("wl");
  var msg = document.getElementById("wl-msg");
  function say(text, cls) { msg.textContent = text; msg.className = "msg " + (cls || ""); }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form).entries());
    if (d.website) return; // bots fill the hidden field
    if (!d.name.trim() || !d.business.trim()) return say("Please add your name and business name.", "err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return say("That email doesn't look right.", "err");

    var btn = form.querySelector("button");
    btn.disabled = true;
    say("Saving your place...");

    fetch(SUPABASE_URL + "/rest/v1/rpc/join_waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: "Bearer " + SUPABASE_ANON },
      body: JSON.stringify({
        p_name: d.name.trim(), p_business: d.business.trim(), p_email: d.email.trim(),
        p_engineers: d.engineers, p_current_system: (d.current_system || "").trim(),
        p_source: new URLSearchParams(location.search).get("utm_source") || document.referrer || ""
      })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      form.reset();
      say("You're on the list. We'll email you the day founding places open.", "ok");
    }).catch(function () {
      say("Sorry, that didn't go through. Email hello@airledger.co.uk and we'll add you.", "err");
    }).finally(function () { btn.disabled = false; });
  });
})();
