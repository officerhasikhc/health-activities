# البنية وقاعدة البيانات

## جداول Google Sheets

## الرابط والطبقات
- الرابط الرسمي للمستخدمين: `https://officerhasikhc.github.io/health-activities`.
- واجهة GitHub Pages داخل `docs/` هي الواجهة الأساسية.
- Apps Script يعمل كخادم خلفي مخفي عبر `Bridge.html` و`postMessage`.
- رابط Apps Script المباشر يعرض صفحة إرشادية للرابط الرسمي ولا يعرض التطبيق الكامل.

### Config — القوائم القابلة للتعديل من لوحة الإدارة
| category | value | active | order |
|---|---|---|---|
| activity_type | محاضرة / ندوة / … | TRUE | 1.. |
| target_group | طلاب / مراجعون / … | TRUE | 1.. |
| mechanism | محاضرة + معرض / … | TRUE | 1.. |
| required_field | objective / photos / mechanism / … | TRUE/FALSE | 1.. |

الحذف منطقي (active=FALSE) للحفاظ على سلامة السجلات القديمة. وفي `required_field` تعني `active=TRUE` أن الحقل مطلوب، و`FALSE` أنه اختياري.

### Users
| emp_no | name | role | title | active |
|---|---|---|---|---|
| 65886 | عبدالباقي… | admin | المشرف الإداري / مسؤول النظام | TRUE |
| 67204 | آمنة… | staff | القائمة بأعمال التثقيف | TRUE |
| 57609 | عائشة… | staff | ممرضة الصحة المدرسية | TRUE |

تسجيل الدخول بالرقم الوظيفي فقط (تحقّق خفيف مناسب لأداة داخلية).

### Activities
`id, created_at, created_by_no, created_by_name, executor_no, executor_name,
type, world_day, title, objective, target_groups, event_date, year, month,
month_name, quarter, location, mechanism, beneficiaries, has_partnership,
partners, photo_folder_id, photo_ids, notes, status`
`type_custom` يُستخدم عند اختيار نوع الفعالية «أخرى».

- `month_name` و`quarter` تُحسب آليًا من التاريخ (أسماء الأشهر بالأحرف، مناسب لتقارير المديرية).
- `photo_ids` قائمة مُعرّفات Drive مفصولة بفواصل؛ الصور في مجلد فرعي باسم الفعالية داخل «أثر - صور الفعاليات».
- «العدد» في تقرير المبادرات = عدّ السجلات حسب العنوان (يُحسب لاحقًا في طبقة التصدير).

## الأدوار
- **admin (المشرف):** يرى الكل، يسجّل نيابةً، يدير القوائم، (لاحقًا) يصدّر.
- **staff (الموظفة):** تسجّل فعالياتها، ترى سجلها فقط، مؤشرات مخففة.

## تدفّق الحفظ المحلي أولًا
الإرسال → IndexedDB (محلي فوري) → محاولة الخادم → عند النجاح يُحذف من المحلي،
وعند الفشل/الانقطاع يبقى ويُرفع تلقائيًا عند عودة الاتصال.
