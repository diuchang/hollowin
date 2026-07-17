// ---- Floating panel: dùng chung cho menu chuột phải trên note-card
//      và dropdown chọn nhanh giá trị (Size/Spacing) ----

let floatingMenuEl = null;

export function closeFloatingMenu() {
  if (!floatingMenuEl) return;
  floatingMenuEl.remove();
  floatingMenuEl = null;
  document.removeEventListener('click', closeFloatingMenu);
  document.removeEventListener('contextmenu', closeFloatingMenu, true);
  document.removeEventListener('scroll', closeFloatingMenuOnOutsideScroll, true);
  document.removeEventListener('keydown', floatingMenuKeydown);
}

function floatingMenuKeydown(e) {
  if (e.key === 'Escape') closeFloatingMenu();
}

// Listener 'scroll' đăng ký ở capture phase nên bắt được cả sự kiện cuộn xảy ra
// NGAY BÊN TRONG panel (vd danh sách value-picker dài, tự nó overflow-y:auto).
// Phải bỏ qua trường hợp đó, chỉ đóng khi người dùng cuộn nội dung phía SAU panel.
function closeFloatingMenuOnOutsideScroll(e) {
  if (floatingMenuEl && floatingMenuEl.contains(e.target)) return;
  closeFloatingMenu();
}

// x,y là góc trên-trái mong muốn; panel tự ghim lại trong viewport nếu bị tràn mép phải/dưới
export function openFloatingMenu(x, y, extraClass, fill) {
  closeFloatingMenu();

  const menu = document.createElement('div');
  menu.className = extraClass ? `ctx-menu ${extraClass}` : 'ctx-menu';
  fill(menu);
  document.body.appendChild(menu);

  const EDGE_GAP = 12; // luôn chừa khoảng cách với mép màn hình, không để panel dán sát lề
  const vw = window.innerWidth, vh = window.innerHeight;
  // Cố tình dùng offsetWidth/offsetHeight thay vì getBoundingClientRect(): panel vừa gắn vào DOM
  // đã bắt đầu chạy animation "pop" (có scale(.98) lúc khởi động), nên rect đo ngay lúc này bị co nhỏ hơn
  // kích thước thật, làm khoảng cách mép bị lệch vài px. offsetWidth/offsetHeight không bị transform ảnh hưởng.
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(EDGE_GAP, Math.min(x, vw - w - EDGE_GAP))}px`;
  menu.style.top = `${Math.max(EDGE_GAP, Math.min(y, vh - h - EDGE_GAP))}px`;

  floatingMenuEl = menu;
  // Trì hoãn 1 tick để chính cú click vừa rồi không lập tức đóng ngay panel mới mở
  setTimeout(() => {
    document.addEventListener('click', closeFloatingMenu);
    document.addEventListener('contextmenu', closeFloatingMenu, true);
    document.addEventListener('scroll', closeFloatingMenuOnOutsideScroll, true);
    document.addEventListener('keydown', floatingMenuKeydown);
  }, 0);
  return menu;
}

// Dropdown chọn nhanh cho ô nhập số (Size/Spacing) — không thay thế việc gõ tay,
// chỉ là lối tắt: bấm nút mũi tên cạnh ô số để chọn nhanh một giá trị có sẵn.
export function openValuePicker(input, values, formatLabel) {
  const toggle = input.parentElement.querySelector('.combo-toggle');
  const r = toggle.getBoundingClientRect();

  openFloatingMenu(r.left, r.bottom + 6, 'value-picker', (menu) => {
    const current = Number(input.value);
    for (const v of values) {
      const b = document.createElement('button');
      b.textContent = formatLabel(v);
      if (v === current) b.classList.add('is-current');
      b.onclick = () => {
        closeFloatingMenu();
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      menu.appendChild(b);
    }
  });
}
