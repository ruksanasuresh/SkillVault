// SkillVault — shared front-end behaviour (prototype, no backend)

document.addEventListener('DOMContentLoaded', () => {
  // nav shadow on scroll (landing page)
  const nav = document.getElementById('nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 8);
    });
  }

  // skill graph bars (dashboard) — mock data, swap for real skill scores later
  const skillContainer = document.getElementById('skill-bars');
  if (skillContainer) {
    const skills = [
      { name: 'Data Structures', pct: 88 },
      { name: 'Web Development', pct: 76 },
      { name: 'Cloud / DevOps', pct: 34 },
      { name: 'Machine Learning', pct: 58 },
      { name: 'Systems Design', pct: 47 },
    ];
    skillContainer.innerHTML = skills.map(s => `
      <div class="skill-bar-row">
        <span class="name">${s.name}</span>
        <span class="skill-track"><span class="skill-fill" style="width:${s.pct}%"></span></span>
        <span class="pct">${s.pct}%</span>
      </div>
    `).join('');
  }
});
