export type HandoffStop =
  | "invalid"
  | "missing"
  | "ambiguous"
  | "disabled"
  | "unavailable"
  | "session"
  | "direct"
  | "limited";

const COPY: Record<HandoffStop, { title: string; body: string }> = {
  invalid: {
    title: "ลิงก์จาก Hub ใช้ไม่ได้",
    body: "ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว กลับไปที่ Hub แล้วเปิด DM-CK อีกครั้ง. This hub link is invalid or expired. Open DM-CK again from the hub.",
  },
  missing: {
    title: "ยังไม่มีบัญชี DM-CK",
    body: "ไม่พบบัญชี DM-CK สำหรับอีเมลของ Hub นี้ ระบบไม่ได้สร้างบัญชีใหม่ และไม่ได้ตั้งรหัสผ่าน. No DM-CK account exists for this hub email. Nothing was created.",
  },
  ambiguous: {
    title: "พบบัญชี DM-CK มากกว่าหนึ่งบัญชี",
    body: "อีเมลนี้ตรงกับบัญชี DM-CK มากกว่าหนึ่งบัญชี จึงไม่เปิดเซสชัน. More than one DM-CK account matches this email, so sign-in stopped.",
  },
  disabled: {
    title: "บัญชี DM-CK ถูกปิดอยู่",
    body: "พบบัญชีนี้แล้ว แต่ถูกปิดใช้งาน จึงไม่เปิดเซสชัน และไม่ได้ตั้งรหัสผ่านใหม่. This DM-CK account is disabled, so sign-in stopped. The password was not changed.",
  },
  unavailable: {
    title: "ยังตรวจบัญชี DM-CK ไม่ได้",
    body: "DM-CK ยังตรวจการส่งต่อจาก Hub ไม่ได้ในขณะนี้. DM-CK cannot check the hub handoff right now.",
  },
  session: {
    title: "เปิดเซสชันไม่สำเร็จ",
    body: "พบบัญชี DM-CK แล้ว แต่เปิดเซสชันไม่สำเร็จ รหัสผ่านเดิมไม่ถูกเปลี่ยน. The DM-CK account exists, but a session could not be opened. The password was not changed.",
  },
  direct: {
    title: "เปิด DM-CK จาก Hub",
    body: "หน้านี้รับเฉพาะการส่งต่อจาก Hub ขณะที่ลงชื่อเข้าใช้อยู่. Open DM-CK from the hub while you are signed in there.",
  },
  limited: {
    title: "ลองใหม่อีกครั้ง",
    body: "มีการเปิดจาก Hub ถี่เกินไป รอสักครู่แล้วเปิด DM-CK จาก Hub อีกครั้ง. Too many hub opens from this network. Wait, then open DM-CK from the hub again.",
  },
};

export function handoffStopPage(reason: HandoffStop): string {
  const copy = COPY[reason];
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)}</title>
</head>
<body>
<main>
  <h1>${escapeHtml(copy.title)}</h1>
  <p>${escapeHtml(copy.body)}</p>
  <p><a href="https://www.db357.com/dashboard">กลับไป Hub</a></p>
  <p><a href="/login">เข้าสู่ระบบด้วยรหัสผ่าน</a></p>
</main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
