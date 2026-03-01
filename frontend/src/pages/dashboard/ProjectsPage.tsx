import React, { useState, useMemo } from 'react';
import { ProjectCard, ProjectData } from '../../components/dashboard/ProjectCard';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

// Mock generation for prototyping
const generateMockProjects = (count: number): ProjectData[] => {
  return Array.from({ length: count }).map((_, i) => {
    // Some are recent, some are older
    const isRecent = Math.random() > 0.6;
    const daysAgo = isRecent ? Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 30);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    return {
      id: `proj-${i}`,
      name: `Untitled Project ${i + 1}`,
      updatedAt: date.toISOString(),
      theme: ['Professional', 'Creative', 'Minimal', 'Dark Mode'][Math.floor(Math.random() * 4)],
      thumbnailUrl: `https://picsum.photos/seed/${i + 1}/800/450`
    };
  });
};

const mockProjects = generateMockProjects(45);

export default function ProjectsPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Derived state
  const recentProjects = useMemo(() => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    return mockProjects
      .filter(p => new Date(p.updatedAt) >= threeDaysAgo)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5); // Keep top 5 most recent max
  }, []);

  const sortedAllProjects = useMemo(() => {
    return [...mockProjects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, []);

  const totalPages = Math.ceil(sortedAllProjects.length / itemsPerPage);
  
  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAllProjects.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAllProjects, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your presentations and slide decks.</p>
        </div>
        <button className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center gap-1.5 rounded-md transition-colors">
          <Plus className="h-4 w-4" />
          <span>New Project</span>
        </button>
      </div>

      {recentProjects.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recentProjects.map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">All Projects</h2>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {sortedAllProjects.length} Total
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 mb-8 auto-rows-max">
          {paginatedProjects.map(project => (
            <div key={project.id} className="min-w-0 flex items-stretch">
              <div className="w-full h-full flex items-stretch">
                <ProjectCard project={project} />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="border border-input bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1;
                // Simple logic to show current, first, last, and slightly around current
                if (
                  pageNum === 1 || 
                  pageNum === totalPages || 
                  (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                ) {
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`h-9 w-9 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ${
                        currentPage === pageNum
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-transparent bg-transparent hover:bg-muted text-foreground'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
                
                // Render ellipses
                if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                  return <span key={pageNum} className="px-1 text-muted-foreground">...</span>;
                }
                
                return null;
              })}
            </div>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="border border-input bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
