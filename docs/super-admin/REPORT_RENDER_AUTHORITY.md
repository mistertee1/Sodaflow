# قبول Super Admin ومصدر Firestore على Render

تحديث **2026-10-11**: المرحلة 5a مكتملة في المصدر، ونجح قبول النسخة `8bc357314d0e96b64c47802863b954c88b7dbbf6` في GitHub وRender: **283 اختبار خادم و37 Firestore Emulator و50 واجهة، منها9 للسوبر أدمن؛ بلا فشل أو skipped**. المرحلة 5b — تفعيل ERP في الإنتاج — ما زالت معطلة بسبب اعتماد Firebase وموضع البيانات وهوية مسؤول محددة وشروط النشر. لم تُكتب معاملات إنتاج للاختبار.

المستخدم دمج [PR38](https://github.com/mistertee1/Sodaflow/pull/38) و[PR39](https://github.com/mistertee1/Sodaflow/pull/39). main المرجعي `0d06eaf65ae43984369c354ec1dcf53986f128b1` يحتوي إصلاح Firestore والمزامنة. هذه الجولة تثبت النتيجة المدمجة وتصحح توقيت assertion صور الهوية في اختبار واحد، وتحفظ التوثيق في [PR49](https://github.com/mistertee1/Sodaflow/pull/49) للمراجعة والدمج بيد المستخدم. لا تغيير لتصميم المنتج أو السجلات المالية أو خدمة الإنتاج.

## نتائج القبول الفعلية

| الفحص | النتيجة على المصدر المقبول |
| --- | --- |
| npm test | 283/283؛ يشمل12 حالة سلطة حفظ جديدة |
| npm run test:emulator | 37/37 على `demo-sudaflow`؛ يشمل4 سيناريوهات سلطة حفظ فعلية |
| Chromium UI | 50/50؛ منها9/9 للسوبر أدمن، والفواتير وPDF والهوية والمزامنة والمحاسبة |
| الأنواع العادية والصارمة والبناء | ناجحة |
| npm audit --omit=dev | 0 ثغرات إنتاج؛ لا ادعاء بفحص خلو كل تبعيات التطوير |
| إثبات خلل النسخة السابقة | 12 حالة:3 نجاح و9 فشل على الملف السابق؛ فشل مقصود يثبت كشف fallback المعيب، ثم ينجح الإصلاح ضمن283 |
| runtime خدمة التقرير | health/report200، مسار ERP API404، POST للتقرير405، Cache-Control:no-store |
| الاختبارات في بيانات عملاء الإنتاج | 0 كتابات |

[CI38119689684](https://github.com/mistertee1/Sodaflow/actions/runs/38119689684) ناجح على `8bc357314d0e96b64c47802863b954c88b7dbbf6`، job114411670173. كذلك [CI main المدمج38084146537](https://github.com/mistertee1/Sodaflow/actions/runs/38084146537) ناجح على `0d06eaf`:283/37/50.

[Render deploy](https://dashboard.render.com/web/srv-db4ui5h42hec73f2cdcg) `dep-db5j66dckfvc73adgthg` أصبح **live في2026-10-11 07:01:23Z**. انتهت الاختبارات في07:01:00Z. تحقق HTTP من [report.json](https://sudaflow-super-admin-acceptance.onrender.com/report.json) يطابق sourceCommit وserviceCommit مع `8bc357314d0e96b64c47802863b954c88b7dbbf6`، والحالة `scope_passed_regression_passed`. `productionReady:false` محفوظة صراحةً.

الخدمة `srv-db4ui5h42hec73f2cdcg` في My Workspace `tea-db20pccs728c73ald730` تستخدم Docker وNode24 وJava21 وChromium. المحاكي والخدمات المالية تعمل داخل مرحلة البناء فقط وببيانات اصطناعية. الصورة النهائية تشغّل ملخص JSON؛ لا ERP/API أو أسرار إنتاج أو منافذ Emulator عامة. autoDeploy معطل. نشر خدمة التقرير لا يثبت تشغيل المنصة على قاعدة العملاء.

## إصلاح مصدر الحفظ والصلاحيات

كان ResilientStore ينقل العملية إلى ملف محلي عند رفض Firestore للاعتماد أو الكتابة، ويستطيع عرض نجاح دون تثبيت بيانات السحابة. هذا قد ينشئ شركة أخرى أو يعيد حصة Free أو يقرأ عقداً وسجل إدارة قديماً، ويعرّض التاريخ المحلي للفقد عند إعادة تشغيل Render.

الإصلاح في PR39، source `29a8c48bc251a6084f856d8ca0ed8b7f04584754`، يحافظ على اسم وواجهة ResilientStore ويستخدم FirestoreStore حصراً. الفشل يصل إلى API503، وإعادة نفس العملية تعود إلى Firestore. لا يستورد أو يمسح ملفات .data الموجودة؛ استردادها يحتاج نسخة محفوظة ومراجعة للمعرّفات والأرصدة. Guest يحتفظ بمساره المحلي.

الاختبارات تثبت رفض الاعتماد والصلاحيات، rollback عند فشل commit، إعادة التسجيل والتعديل التجاري دون تكرار، فشل HTTP دون نجاح محلي وهمي، رفض عقد محلي يخالف اشتراك السحابة المنتهي، استمرار حد100 فاتورة بعد التعافي، ورفض مسؤول سُحبت صلاحيته رغم وجود سجل محلي قديم. الاختبارات القديمة للباقات والأقسام الخمسة وFeatures وRules والمعاينة والترحيل محفوظة؛ كل اختبارات الكتابة تستخدم MemoryStore أو Emulator `demo-sudaflow`.

## إصلاح بوابة اختبار صور الهوية

[CI38119218903](https://github.com/mistertee1/Sodaflow/actions/runs/38119218903) على `47aa3f2435b5b31e2db893d89f4605bea342c5a7` انتهى UI49/50 رغم نجاح283 unit و37 Emulator و9/9 للسوبر أدمن. حالة RTL brand تقرأ img.complete وnaturalWidth لكل صور الهوية فور ظهور أول شعار.

راجعت [artifact11694249893](https://github.com/mistertee1/Sodaflow/actions/runs/38119218903/artifacts/11694249893): طلبات SVG الأربعة رجعت200 بلا أخطاء شبكة، وقراءة الشرط الفورية رجعتfalse. هذا يدعم تفسير سباق توقيت اكتمال تحميل/فك صور مضافة بصورة غير متزامنة؛ لا يثبت وجود ملف شعار مفقود.

commit `8bc357314d0e96b64c47802863b954c88b7dbbf6` يغيّر assertion واحداً إلى expect.poll بحد5 ثوانٍ، مع نفس شرط **complete && naturalWidth>0 لكل صورة**. لا sleep أو إعادة تشغيل test كاملاً أو إسقاط صورة أو تخفيف للشرط. لا تغيير للواجهة أو SVG أو assertions الفواتير. [مرجع Playwright الرسمي](https://playwright.dev/docs/test-assertions#expectpoll). المصدر المعدل اجتاز الاختبار وكل50 UI على CI وRender.

## تاريخ محاولات Render

| المصدر / Deploy | النتيجة | التفسير والإجراء |
| --- | --- | --- |
| `40232c4` / `dep-db4ui6142hec73f2ce8g` | build_failed؛283 unit،37 Emulator،UI42/50،SA8/9 | NODE_ENV=test انتقل إلى Vite؛ صحح بناء المتصفح إلىproduction دون تعديل assertions |
| `29a8c48` / `dep-db4uo40473hc7397mih0` | live؛283/37،UI44/50،SA9/9 | الفشل الست مطابق للأساس قبل إصلاحات PR38؛ عُرض كقبول نطاق مع regression معطل |
| `47aa3f2` / `dep-db5j25h42hec7395ek3g` | live؛283/37/50،SA9/9 | main المدمج محفوظ؛ CI منفصل كشف سباق assertion الصور المذكور أعلاه |
| `8bc3573` / `dep-db5j66dckfvc73adgthg` | live؛283/37/50،SA9/9،CI ناجح | قبول المصدر النهائي بلا فشل أو skipped |

لا تُحذف النتائج الفاشلة من التاريخ ولا يُنسب الفشل الست القديم إلى المصدر الحالي. عالج الإيجينت المحاسبي اكتشاف المؤسسة دون اختلاق tenant عند الانقطاع، وحدث أربعة tests لتدخل «معاينة المستند» من مسار الفاتورة الحالي. راجعت فرق main واحتفظت به كما دمجه المستخدم.

## الإنتاج وما بقي غير متحقق

فحص قراءة فقط بتاريخ **2026-10-11 06:46 UTC**:

| الفحص | النتيجة |
| --- | --- |
| [health](https://sudaflow.onrender.com/api/health) | 200، release2026-10-05-central-sync-recovery |
| [readiness](https://sudaflow.onrender.com/api/health/ready) | 503 عند Firebase، code service_unavailable، قبل اختبار Firestore |
| سجل Render | MetadataLookupWarning:ETIMEDOUT/ENOTFOUND |
| هوية المشروع/القاعدة المهيأة | sodaflow / (default)، دون إثبات وجود قاعدة العملاء أو صلاحيتها |
| anonymous session/overview/companies | 401؛ يثبت بوابة الدخول المجهول فقط |
| Render ERP `srv-db4lfrvavr4c73fn1hl0` | فرع `codex/wafer-ux-phase1`، live `af3acda73b24cbde0457349df76fb00e81a0e3d0`؛ لم يُنشر main الحالي إليه |
| UID إدارة مؤكد | لم يُحدد |
| تعديل إعداد/Rules/claims/migration/معاملة إنتاج | لم يُنفذ في الجولة |

تشخيص القاعدة المفقودة في5 أكتوبر تاريخي. الفحص الحالي يتوقف عند الاعتماد؛ وجود قاعدة العملاء وIAM والفهارس وStorage ومزامنة حساب فعلي غير متحقق. لا يثبت HTTP200 لصفحة HTML دخول مسؤول أو نجاح الحفظ.

المطلوب لاستكمال5b:

1. اعتماد Firebase صحيح للمشروع الذي يحتوي بيانات العملاء، عبر أسرار Render مثل FIREBASE_SERVICE_ACCOUNT_JSON؛ دون وضع قيمه في الكود أو المحادثة أو build args.
2. تحديد قاعدة العملاء الأصلية ونسخة احتياطية، وحفظ ومراجعة أي `.data/sudaflow_server_store.json` سابق. لا استيراد تلقائي أو قاعدة بديلة فارغة لتغطية تاريخ مفقود.
3. UID مسؤول محدد ومؤكد، ثم مراجعة bootstrap preview. لا يُستنتج المسؤول من أول Owner أو عنوان بريد.
4. مراجعة migration preview ثم نشر منسق للخادم والواجهة وRules والفهارس، وقبول تشغيل فعلي على شركة اصطناعية معتمدة. لا معاملات مالية لعملاء حقيقيين لاختبار النظام.

[OPERATIONS.md](OPERATIONS.md) يحدد الأوامر وبوابة التشغيل. لم تُنشأ مفاتيح ولم تُقرأ قيم أسرار ولم تُمنح صلاحية لحساب مجهول، ولم تتغير خدمة ERP أو خدمة اختبارات المحاسبة.

## تسليم الجولة

التحديثات في PR49، والدمج بيد المستخدم. راجعت فرع الإيجينت النشط PR48/C5 وlease الخاصة به؛ app.spec ليس ضمن ملفاته. التغيير فيه محصور في انتظار صور الهوية؛ ملفات المحاسبة وpackage وRules والهوية والمزامنة محفوظة.

[الأدلة الآلية](EVIDENCE_RENDER_AUTHORITY_20261011.json) تسجل المصدر والنتائج والمحاولات وفحص الإنتاج. checkpoint يحرر activeRunId/leaseUntil ويحدد5a مكتملة و5b معطلة، ويحفظ PR49 وفرع العمل. المتابعة التلقائية تبقى معلقة لأن المتبقي يتطلب اعتماداً وهوية وقرار بيانات ومراجعة تشغيل؛ لا تعاد أعمال المصدر المقبولة بلا تغيير مؤثر.
