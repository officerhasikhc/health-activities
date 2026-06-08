# أثر — منصة توثيق الفعاليات والمبادرات

تطبيق ويب لتوثيق الفعاليات والمبادرات الصحية (محاضرات، ندوات، أيام عالمية، أركان صحية، شراكات…) مع صورها وبياناتها، وتوليد التقارير لاحقًا.

**الجهة:** المديرية العامة للخدمات الصحية بمحافظة ظفار — التجمّع الصحي (٢)، مركز صحي حاسك.

---

## التقنية

| الطبقة | الأداة |
|---|---|
| الرابط الرسمي | GitHub Pages (`docs/`) |
| الخادم الخلفي | Google Apps Script (Web App مخفي عبر Bridge) |
| الواجهة | HTML/CSS/JS عربي RTL (تصميم رسمي) |
| قاعدة البيانات | Google Sheets |
| تخزين الصور | Google Drive |
| الإصدارات | Git + GitHub |
| الجسر/النشر | clasp + GitHub Actions |

> الرابط الرسمي للمستخدمين هو GitHub Pages: https://officerhasikhc.github.io/health-activities  
> Apps Script يبقى خادمًا خلفيًا مخفيًا للبيانات والصور وPDF، وclasp يزامن `src/` مع مشروع جوجل.

## بنية المجلدات

```
athar/
├─ src/                  ← مصدر تطبيق Apps Script (هذا ما يُرفع عبر clasp)
│  ├─ appsscript.json
│  ├─ Code.gs            ← الخادم: التهيئة، المصادقة، الفعاليات، الصور، المؤشرات
│  ├─ Index.html         ← الهيكل
│  ├─ Stylesheet.html    ← التصميم
│  ├─ JavaScript.html    ← منطق الواجهة (نماذج، سجل، مؤشرات، إدارة)
│  └─ Offline.html       ← الحفظ المحلي أولًا ثم المزامنة (IndexedDB)
├─ assets/logo/          ← ضع الشعار هنا (لا يُرفع إلى Apps Script)
├─ docs/                 ← واجهة GitHub Pages + ARCHITECTURE.md و ROADMAP.md
├─ .github/workflows/    ← النشر التلقائي
├─ .clasp.json           ← يحوي scriptId و rootDir
├─ package.json
└─ .gitignore / .claspignore
```

---

## التهيئة لأول مرة (على جهازك — Windows)

المتطلبات: تثبيت [Node.js](https://nodejs.org)، وتفعيل **Apps Script API** من https://script.google.com/home/usersettings

```powershell
cd C:\Users\super\athar
npm install                      # يثبّت clasp محليًا
npx clasp login                  # سجّل دخول حساب officerhasikhc@gmail.com
```

ضع **Script ID** في `.clasp.json` (تجده في محرر Apps Script: Project Settings ← IDs)، ثم ارفع الكود:

```powershell
npx clasp push -f                # يرفع src/ إلى مشروع Apps Script
```

شغّل دالة `setup` مرة واحدة من المحرر (تُنشئ الجداول والمجلد والمستخدمين)، ثم انشر:
**Deploy ← New deployment ← Web app** (Execute as Me، Access Anyone).

## دورة العمل اليومية

```powershell
# بعد أي تعديل محلي:
git add .
git commit -m "وصف التغيير"
git push                         # GitHub Action يرفع وينشر تلقائيًا

# أو نشر يدوي سريع دون GitHub:
npx clasp push -f
```

### ربط GitHub (مرة واحدة)

```powershell
cd C:\Users\super\athar
git init
git add .
git commit -m "أثر — النسخة الأولى"
git branch -M main
git remote add origin https://github.com/<حسابك>/athar.git
git push -u origin main
```

ثم أضف **أسرار المستودع** (Settings ← Secrets and variables ← Actions):
- `CLASPRC_JSON` = المحتوى الكامل لملف `~/.clasprc.json` (يُنشأ بعد `clasp login`؛ على ويندوز مساره `C:\Users\super\.clasprc.json`).
- `DEPLOYMENT_ID` = مُعرّف النشر `AKfycbz…` (اختياري، لإبقاء الرابط ثابتًا عند كل نشر).

من الآن: كل `git push` يرفع الكود وينشره تلقائيًا على نفس الرابط.

---

## تحسينات الأداء والاستقرار في هذه النسخة (v1.1)

- **استدعاء إقلاع واحد** (`init`) يجمع تسجيل الدخول والقوائم — نصف عدد النداءات عند الدخول.
- **تخزين مؤقت للقوائم** على الخادم (CacheService، ٦ ساعات).
- **تخزين مؤقت للسجل والمؤشرات** في المتصفح خلال الجلسة، ويُحدَّث تلقائيًا عند الحفظ/الحذف.
- **حفظ محلي أولًا ثم مزامنة** (IndexedDB outbox): الإرسال يُحفظ محليًا فورًا، ثم يُرفع؛ وإن انقطعت الشبكة يبقى محليًا ويُرفع تلقائيًا عند عودتها، مع مؤشر «بانتظار الرفع».
- **حفظ تلقائي للمسودة** مع debounce (لا يثقل الكتابة).
- **ضغط الصور في المتصفح** قبل الرفع (1600px / جودة 0.8).
- **تحميل كسول للصور** (`loading="lazy"`).
- **قراءة/كتابة مجمّعة** على Sheets.

انظر `docs/ROADMAP.md` للخطوات القادمة (التصدير المنظّم بالصور وقالب المديرية، المصادقة بـ PIN، الترقيم، إلخ).
