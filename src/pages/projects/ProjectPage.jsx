// Old project links (/p/:id) now open the team workspace at /projects/:id.
import { Navigate, useParams } from 'react-router-dom';

export default function ProjectPage() {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId}`} replace />;
}
