# إصلاح بدء Firebase API على Netlify —21 أكتوبر2026

الحالة: قيد قبول CI في PR113، لم يُنشر أو يُدمج بواسطة الإيجينت. الأساس main `ddb00e8491f72134d523bb0632ed901df9f8078a`، وفيه دمج المستخدم PR109.

## العطل المثبت

الصورة تعرض رسالة «خدمة الحفظ السحابي غير مهيأة» على sodaflow.netlify.app. الفحص المباشر لـ /api/health و/api/health/ready و/api/organizations يعيد HTTP502 بنص غير JSON: ERR_REQUIRE_ESM من jwks-rsa/src/utils.js عند require('jose'). الانهيار يحصل قبل فحص Firebase/Firestore؛ هذا عطل مختلف عن readiness503 التاريخي لخدمة Render.

الـlock الحالي يثبت firebase-admin14.5.0 وjwks-rsa4.1.0 وjose6.2.12. أعدنا نفس الخطأ على Node20.18.0، وأيضاً على Node24 عند تطبيق --no-experimental-require-module. إصدار Node الحي على Netlify غير مؤكد لأن الوصول إلى مشروعه غير متاح؛ لا نستنتجه من الخطأ. وثائق AWS تؤكد تعطيل require(esm) على Lambda حتى مع Node22/24.

## الإصلاح

- Netlify يبني باستخدام Node24 صراحةً، وpackage.engines يعلن Node22.12+ أو24+. فحص مبكر يرفض build قديم أو AWS_LAMBDA_JS_RUNTIME قديماً ويشغّل سلسلة استيراد Firebase فعلياً تحت قيود Lambda قبل Vite.
- تثبيت jwks-rsa4.1.0 ضمن اعتماد Firebase الحالي، مع إصلاح توافق محدود لموقعي تحميل jose في utils وPassport: dynamic import غير متزامن بدلاً من require المتزامن. تستمر واجهة مفاتيح التوقيع وcallback الخاصة بـPassport؛ لا تغيير لخوارزميات التحقق أو الصلاحيات.
- postinstall يطبق الإصلاح، وفحص البناء يطبقه أيضاً إذا عُطلت lifecycle scripts. التحقق يربط إصدار4.1.0 وبصمة SHA256 الأصلية/المعدلة لكل ملف. أي إصدار أو محتوى غير مراجع يوقف البناء؛ التنفيذ المتكرر لا يغير النسخة المصححة. تُراجع هذه الطبقة عند تحديث الاعتماد أو وصول إصلاح upstream.
- لم ننزّل إصدار Firebase Admin أوjose أوjwks-rsa. أضيف override لإصدارJWKS الموجود، وتحديث أمني منفصل لـVite6.4.5 بعد أن كشف audit اليوم ثغرة عالية في6.4.3. كل تغييرات lock تُراجع ولا يُستبدل بملف قديم.
- الاختبارات الجديدة تشغّل دالة Netlify المجمعة وSDK الحقيقي مع تعطيل require(esm) وmodule detection كما في Lambda، وتتحقق من مفاتيح RSA وتوقيع صحيح ورفض توقيع معدل وkid مجهول ومفاتيح متماثلة، ومسار callback الصحيح/التالف.
- لا تغيير لملفات server/admin.ts أوserver/api.ts أوواجهة المحاسبة في PR111. يبقى API والاشتراك وRules ومصدر Firestore الحصري كما هي.

## الاختبارات حتى الآن

- npm ci نظيف: postinstall ناجح، وإعادة التطبيق لا تغير الملفات.
-14/14 اختبار توافق/بدء/صلاحيات ناجحة تحت قيود Lambda، بينها health200 وHEAD ورفض الشركات/Super Admin/معاملة مالية مجهولة بـ401. غياب الاعتماد يعطي readiness503 JSON واضحاً بعد نجاح بدء الدالة؛ لا نجاح وهمي أو fallback محلي.
-369/369 unit/API، والأنواع وcore والبناء ناجحة محلياً. npm run build:netlify ناجح ويخرج الواجهة فقط، بلا dist/server.mjs منشور كملف ثابت.
- npm audit --omit=dev: كشف اعتماد Vite القديم ثغرة عالية؛ تم تحديث lock إلى6.4.5، والتحقق النهائي جارٍ.
- أداة Netlify الرسمية @netlify/zip-it-and-ship-it16.4.0 أنشأت API ZIP بحجم5,347,927 بايت. فُحصت بصمتا الملفين داخل ZIP، وشُغلت الدالة من الحزمة المعزولة تحت قيود Lambda: health200، شركات/إدارة401، واعتماد ناقص503 JSON، وكلها no-store. هذا اختبار artifact محلي، وليس نشراً على Netlify.
- قبول GitHub الكامل وNode22 الإضافي ما زال جارياً. لا يُعد الفرع جاهزاً قبله؛ الكتابات المالية الاختبارية محصورة في MemoryStore وEmulator demo-sudaflow ضمن المجموعة القائمة.

## النشر وما بقي غير متحقق

البحث العام في قائمة مشاريع التكامل لم يعرض sodaflow، لكن الاستعلام المباشر بالنطاق نجح وحدد الموقع35454707-bde1-4449-a522-9c1f0864fff6. النشر المنشور6ad7bfd80fef652f907ca829 يتبع main عندddb00e8، وفيه دالة واحدة؛ إذن المشكلة في بدء الدالة لا في غياب API. لم يُستخدم موقع آخر ولم يُعد طلب تسجيل دخول مرفوض. تُترك مراجعة/دمج PR113 للمستخدم، ثم full build للواجهة وFunctions على المشروع الصحيح. لو وُجد override قديم لـAWS_LAMBDA_JS_RUNTIME يُزال أو يضبط على nodejs24.x من إعداد Netlify؛ لا يوضع هذا المتغير في TOML.

بعد النشر: يجب أن يرجع /api/health JSON200، وتبقى جلسة مجهولة401. ثم تُراجع /api/health/ready لتأكيد اعتماد Firebase وFirestore على المشروع المقصود؛ فشل تشغيل الوحدة لا يثبت غياب الاعتماد أو وجود قاعدة عملاء. هذا العمل لا ينشئ قاعدة أو يستورد .data أو يمنح Super Admin أو يغير Rules/claims أو يختبر بكتابة معاملات عملاء حقيقيين.

## المراجع

- Netlify runtime: https://docs.netlify.com/build/functions/configuration/#nodejs-version-for-runtime
- AWS Lambda experimental defaults: https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html#nodejs-experimental-features
- مصدر الاعتماد: https://github.com/auth0/node-jwks-rsa
- SDK/JOSE والنسخ المحددة: package-lock.json وscripts/patch-jwks-runtime.mjs.
