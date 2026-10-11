/* =========================================================================================
   auth/messages-zh.js: what the Chinese sign-in pages (/auth/zh/*.html) say, in Simplified
   Chinese (RP-29). Our suppliers and the China procurement team are in China, so their sign-in
   is Chinese first.
   - MESSAGES_ZH has exactly the keys of MESSAGES in auth/auth-lib.js (tests/auth-zh.test.mjs),
     and, like it, nothing here says whether an account exists.
   - UI_ZH has exactly the keys of UI in auth/auth-lib.js: the words auth.js puts on the page.
   - password_length repeats PASSWORD_MIN and PASSWORD_MAX (12 and 72) as numbers, because
     auth-lib.js imports this file; the tests check they agree.
   We wrote this copy ourselves: a native speaker checks it before production (ZH_REVIEWED).
   ========================================================================================= */
export const ZH_REVIEWED = false;

export const MESSAGES_ZH = Object.freeze({
  // the exchange (§4.3)
  invalid_input: '请求有误。请刷新页面后重试。',
  privacy_ack_required: '请勾选“我已阅读隐私声明”后继续。',
  invalid_token: '登录未成功。请重新登录。',
  session_ended: '您的登录已结束。请重新登录。',
  email_unconfirmed: '请先确认您的邮箱：打开我们发给您的链接。',
  reauth_required: '为了您的安全，请用密码重新登录。',
  cross_origin: '只能在我们的官方网站上登录。请在官网打开登录页面后重试。',
  origin_required: '只能在我们的官方网站上登录。请在官网打开登录页面后重试。',
  not_allowed_here: '此邮箱无法在当前版本的网站上登录。',
  signup_closed: '您的账户已确认。账户即将开放。',
  account_disabled: '此账户已停用。请联系我们。',
  invitation_needs_link: '此邀请链接已过期或已被使用。请索取新的邀请。',
  link_requires_invitation: '首次登录时，请打开您收到的邀请链接。如需新的邀请，请联系邀请您的人。',
  mfa_required: '此登录需要第二步验证，本页面暂不支持。请联系我们，我们会协助您。',
  email_in_use: '我们无法完成此登录的设置。请联系我们，我们会为您处理。',
  account_already_linked: '我们无法完成此登录的设置。请按您之前的方式登录，或联系我们。',
  confirm_link_required: '如需完成设置，请打开我们发给您的邮件中的链接。',
  exchange_race: '两次登录同时进行，发生了冲突。请重新登录。',
  rate_limited: '尝试次数过多。请等待几分钟后再试。',
  auth_unavailable: '您已登录，但工作室暂时无法访问。',
  auth_settings_unsafe: '您已登录，但工作室暂时无法访问。',
  unavailable: '您已登录，但工作室暂时无法访问。',
  network: '您已登录，但工作室暂时无法访问。',
  unexpected: '出现了问题。请稍后再试。',
  // the pages themselves
  bad_credentials: '邮箱和密码不匹配，或账户尚未确认。',
  captcha_failed: '安全验证未通过。请再试一次。',
  captcha_needed: '请先完成安全验证。',
  supabase_network: '无法连接登录服务。请检查网络连接后重试。',
  weak_password: '请换一个密码：这个密码太容易被猜到，或曾出现在数据泄露中。',
  same_password: '请选择一个此账户以前没有用过的密码。',
  password_length: '密码须为 12 至 72 个字符。',
  passwords_differ: '两次输入的密码不一致。',
  link_incomplete: '此链接不完整。请重新打开邮件中的链接，或索取新的链接。',
  paste_not_link: '这不是我们的登录链接。请粘贴邮件按钮所打开页面的完整地址（以 localhost 开头），或按钮本身的链接。',
  paste_empty: '请先粘贴链接。',
  paste_lost: '此页面丢失了链接。请在下方重新粘贴，或索取新的链接。',
  reset_too_slow: '距离打开邮件中的链接已超过 10 分钟。请索取新的重置链接，并立即完成。',
  link_expired: '此链接已过期或已被使用。请索取新的链接。',
  link_expired_invite: '此邀请链接已过期或已被使用。请索取新的邀请。',
  session_missing: '您的链接已过期。请重新打开邮件中的链接，或索取新的链接。',
  signup_sent: '请查看您的邮箱，确认您的账户。',
  reset_sent: '如果该邮箱已开通账户，我们已发送链接。',
  resend_sent: '如果该邮箱有等待确认的账户，我们已发送新的链接。',
  password_set: '密码已设置。您仅在此设备上保持登录。',
  password_changed: '密码已更改。您仅在此设备上保持登录。',
  accounts_closed: '账户即将开放。请向我们发送咨询，我们会为您开通，或请您的顾问发送邀请。',
  not_configured: '登录功能正在设置中，很快即可使用。在此之前，请向我们发送咨询，我们会协助您。'
});

export const UI_ZH = Object.freeze({
  title_suffix: ' — Bargainhub 工作室',
  spent_title: '此链接无法使用',
  spent_sub: '如果邮件中的链接打开了不止一个页面，请在下方粘贴第一个页面的地址；否则请索取新的链接。',
  paste_title: '粘贴邮件中的链接',
  paste_sub: '请在下方粘贴以继续。',
  choose_password: '设置您的密码',
  confirm_email: ['确认您的邮箱', '点击“确认”，完成账户设置。', '确认'],
  confirm_email_change: ['确认您的新邮箱', '点击“确认”，开始使用您的新邮箱地址。', '确认'],
  confirm_recovery: ['重置密码', '点击“确认”，然后设置新密码。', '确认'],
  confirm_invite: ['接受邀请', '请阅读隐私声明并勾选，然后点击“确认并继续”设置密码。', '确认并继续'],
  reauth_note: '新密码已保存。请用新密码登录以继续。',
  enter_email: '请输入您的邮箱地址。',
  enter_password: '请输入您的密码。',
  enter_name: '请输入您的姓名。',
  enter_other: '请填写此项。',
  tick_box: '请勾选此项后继续。',
  email_format: '请输入有效的邮箱地址，例如 name@example.com。',
  min_chars: '请至少输入 {n} 个字符。',
  max_chars: '最多输入 {n} 个字符。',
  show: '显示',
  hide: '隐藏',
  show_password: '显示密码',
  hide_password: '隐藏密码',
  signing_in: '正在登录…',
  sending: '正在发送…',
  confirming: '正在确认…',
  saving: '正在保存…',
  opening: '正在打开…',
  trying_again: '正在重试…',
  captcha_load_failed: '安全验证无法加载。请刷新页面，或检查是否有程序拦截了 challenges.cloudflare.com。'
});
