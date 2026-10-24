const tools = document.querySelector('.timeline-tools');
const filters = [...document.querySelectorAll('[data-filter]')];
const events = [...document.querySelectorAll('.cv-event')];
const count = document.querySelector('#timeline-count');
tools.hidden = false;
filters.forEach(button => {
  button.addEventListener('click', () => {
    const category = button.dataset.filter;
    filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
    events.forEach(event => { event.hidden = category !== 'all' && event.dataset.category !== category; });
    count.textContent = `${events.filter(event => !event.hidden).length} milestones`;
  });
});

const progress = document.querySelector('.reading-progress');
const sections = [...document.querySelectorAll('.cv-section')];
const jumpLinks = [...document.querySelectorAll('.cv-jump a')];
let scheduled = false;
function updateReadingPosition() {
  const range = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0})`;
  let current = null;
  sections.forEach(section => {
    if (section.getBoundingClientRect().top <= 180) current = section.id;
  });
  jumpLinks.forEach(link => {
    if (link.hash === `#${current}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  scheduled = false;
}
function scheduleReadingUpdate() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(updateReadingPosition);
  }
}
window.addEventListener('scroll', scheduleReadingUpdate, { passive: true });
window.addEventListener('resize', scheduleReadingUpdate, { passive: true });
filters.forEach(button => button.addEventListener('click', scheduleReadingUpdate));
window.addEventListener('load', scheduleReadingUpdate);
updateReadingPosition();
