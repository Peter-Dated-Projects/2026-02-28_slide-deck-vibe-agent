import React from 'react';
import { Package, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface ProjectData {
  id: string;
  name: string;
  updatedAt: string;
  createdAt?: string;
  thumbnailUrl?: string;
  theme?: string;
}

interface ProjectCardProps {
  project: ProjectData;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, onEdit, onDelete, className = "" }) => {
  // Mock format date
  const dateStr = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className={`group relative flex flex-col bg-card/60 backdrop-blur-xl border border-border rounded-xl shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden min-w-[300px] max-w-[500px] ${className}`}>
      <Link to={`/chat/${project.id}`} className="block flex-1">
        {/* 16:9 Thumbnail Area */}
        <div className="w-full aspect-video bg-muted relative overflow-hidden flex items-center justify-center group-hover:bg-muted/80 transition-colors pointer-events-none">
          {project.thumbnailUrl ? (
            <img src={project.thumbnailUrl} alt={project.name} className="w-full h-full object-cover" />
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
        <Link to={`/chat/${project.id}`} className="min-w-0 flex-1">
          <h3 className="text-base font-bold leading-tight text-foreground truncate group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            Edited {dateStr}
          </p>
        </Link>
        
        {/* Actions (visible on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(project.id); }}
              className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
              title="Edit details"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(project.id); }}
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
