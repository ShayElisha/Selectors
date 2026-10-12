# שיבוצון

אפליקציית ווב לניהול ושיבוץ בודקים בעמדות שער יציאה — React + MongoDB Atlas + Vercel.

## פיתוח מקומי

1. העתיקו `.env.example` ל-`.env` והדביקו את `MONGODB_URI`.
2. הריצו:

```bash
npm install
npm run dev
```

- Frontend: `http://127.0.0.1:5173`
- API מקומי: `http://127.0.0.1:3001` (דרך Vite proxy ל-`/api`)

## פריסה ל-Vercel

להוראות פריסה מלאות, כולל כל משתני הסביבה והגדרות MongoDB Atlas, עיינו ב-[DEPLOY.md](./DEPLOY.md).
אל תפתחו גישה ל-MongoDB לכל כתובות ה-IP. הגדירו allowlist מצומצם בהתאם ל-egress IPs של סביבת הפריסה.

ה-API רץ כפונקציית שרת אחת (`api/index.js`) שמעבירה כל נתיב `/api/*` לאפליקציית Express. הפרונט נבנה מ-Vite ל-`dist`.

## אבטחה

אל תעלו את `.env` ל-Git. אם סיסמה נחשפה — החליפו אותה ב-Atlas.
