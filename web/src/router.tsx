import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RouteFallback } from './components/RouteFallback'

const AdminPage = lazy(() => import('./routes/AdminPage.tsx'))
const EventPage = lazy(() => import('./routes/EventPage.tsx'))
const ConnectPage = lazy(() => import('./routes/ConnectPage.tsx'))
const MatPickPage = lazy(() => import('./routes/MatPickPage.tsx'))
const ScorerPage = lazy(() => import('./routes/ScorerPage.tsx'))
const BoardPage = lazy(() => import('./routes/BoardPage.tsx'))

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/admin" replace /> },
  { path: '/admin', element: withSuspense(<AdminPage />) },
  { path: '/events/:eventId', element: withSuspense(<EventPage />) },
  { path: '/connect', element: withSuspense(<ConnectPage />) },
  { path: '/mat', element: withSuspense(<MatPickPage />) },
  { path: '/mat/:matId', element: withSuspense(<ScorerPage />) },
  { path: '/board/:eventId', element: withSuspense(<BoardPage />) },
]

export const router = createBrowserRouter(routes)
