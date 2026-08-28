import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import AdminPage from './routes/AdminPage.tsx'
import EventPage from './routes/EventPage.tsx'
import ConnectPage from './routes/ConnectPage.tsx'
import MatPickPage from './routes/MatPickPage.tsx'
import ScorerPage from './routes/ScorerPage.tsx'
import BoardPage from './routes/BoardPage.tsx'

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/admin" replace /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '/events/:eventId', element: <EventPage /> },
  { path: '/connect', element: <ConnectPage /> },
  { path: '/mat', element: <MatPickPage /> },
  { path: '/mat/:matId', element: <ScorerPage /> },
  { path: '/board/:eventId', element: <BoardPage /> },
]

export const router = createBrowserRouter(routes)
