import React, { useMemo, useState } from "react";
import { CheckSquare, Square, ChevronDown, ChevronUp } from "lucide-react";

export interface AgentTask {
  id: string;
  title: string;
  done: boolean;
}

interface TaskListBarProps {
  tasks: AgentTask[];
}

export const TaskListBar: React.FC<TaskListBarProps> = ({ tasks }) => {
  const [isOpen, setIsOpen] = useState(false);

  const { total, remaining } = useMemo(() => {
    const totalCount = tasks.length;
    const remainingCount = tasks.reduce((count, task) => count + (task.done ? 0 : 1), 0);
    return { total: totalCount, remaining: remainingCount };
  }, [tasks]);

  return (
    <div className="relative">
      {isOpen && (
        <div className="absolute bottom-full w-full border border-border bg-card shadow-sm max-h-[150px] overflow-y-auto custom-scrollbar z-20">
          {tasks.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-muted-foreground">No active tasks yet.</p>
          ) : (
            <ul className="p-1">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-2 px-2 py-1.5 text-[10px] text-foreground"
                >
                  {task.done ? (
                    <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={task.done ? "line-through text-muted-foreground" : ""}>
                    {task.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="w-full h-6 border border-border bg-background/70 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-between"
      >
        <span className="truncate">
          Task List: '{total - remaining}/{total}' tasks completed
        </span>
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
    </div>
  );
};
