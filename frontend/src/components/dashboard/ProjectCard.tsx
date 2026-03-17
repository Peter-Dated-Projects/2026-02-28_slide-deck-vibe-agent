import React from "react";
import { Package, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

export interface ProjectData {
  id: string;
  name: string;
  updatedAt: string;
  createdAt?: string;
  thumbnailUrl?: string;
  theme?: string;
  latest_conversation_id?: string;
}

interface ProjectCardProps {
  project: ProjectData;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onThumbnailUnavailable?: (id: string) => void;
  className?: string;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onEdit,
  onDelete,
  onThumbnailUnavailable,
  className = "",
}) => {
  const missingThumbnailRequestedRef = React.useRef(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!project.thumbnailUrl && onThumbnailUnavailable && !missingThumbnailRequestedRef.current) {
      missingThumbnailRequestedRef.current = true;
      onThumbnailUnavailable(project.id);
    }
  }, [project.id, project.thumbnailUrl, onThumbnailUnavailable]);

  React.useEffect(() => {
    if (project.thumbnailUrl) {
      missingThumbnailRequestedRef.current = false;
    }
  }, [project.thumbnailUrl]);

  const handleThumbnailError = () => {
    onThumbnailUnavailable?.(project.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onDelete) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const handleMenuDelete = () => {
    if (!onDelete) return;
    onDelete(project.id);
    setMenu(null);
  };

  React.useEffect(() => {
    if (!menu) return;

    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  // Mock format date
  const dateStr = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      onContextMenu={handleContextMenu}
      className={`group relative flex flex-col bg-card/60 backdrop-blur-xl border border-border rounded-xl shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden min-w-[300px] max-w-[500px] ${className}`}
    >
      {menu && (
        <div
          ref={menuRef}
          style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 9999 }}
          className="min-w-[160px] rounded-lg border border-border bg-popover shadow-lg py-1 text-xs"
        >
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleMenuDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 transition-colors text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete project
          </button>
        </div>
      )}

      <Link
        to={`/chat/${project.latest_conversation_id}?projectId=${project.id}`}
        className="block flex-1"
      >
        {/* 16:9 Thumbnail Area */}
        <div className="w-full aspect-video bg-muted relative overflow-hidden flex items-center justify-center group-hover:bg-muted/80 transition-colors pointer-events-none">
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt={project.name}
              className="w-full h-full object-cover"
              onError={handleThumbnailError}
            />
          ) : (
            <div className="flex flex-col items-center justify-center opacity-30 text-muted-foreground">
              <Package className="h-12 w-12 mb-2" />
              <span className="text-xs font-medium tracking-wide">NO PREVIEW</span>
            </div>
          )}

          {/* Theme Badge Overlay */}
          {project.theme && (
            <div className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full border border-background/20 bg-background/50 backdrop-blur-md text-foreground text-[10px] font-semibold tracking-wider uppercase shadow-sm">
              {project.theme}
            </div>
          )}
        </div>
      </Link>

      {/* Card Info Footer */}
      <div className="p-4 flex items-start justify-between gap-4 border-t border-border/50 bg-card">
        <Link
          to={`/chat/${project.latest_conversation_id}?projectId=${project.id}`}
          className="min-w-0 flex-1"
        >
          <h3 className="text-base font-bold leading-tight text-foreground truncate group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 truncate">Edited {dateStr}</p>
        </Link>

        {/* Actions (visible on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(project.id);
              }}
              className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
              title="Edit details"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(project.id);
              }}
              className="p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors"
              title="Delete project"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
