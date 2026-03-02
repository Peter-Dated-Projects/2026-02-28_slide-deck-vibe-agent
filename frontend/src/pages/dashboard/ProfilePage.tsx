import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, Mail, Calendar, Edit3, Briefcase, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ProfilePage() {
  const { user } = useAuth();
  
  if (!user) return null;

  const joinDate = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Unknown';

  return (
    <div className="max-w-4xl pb-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your public profile and personal details.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column - Card Summary */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm p-6 flex flex-col items-center text-center">
            <div className="w-32 h-32 rounded-full overflow-hidden mb-4 border-4 border-background shadow-md bg-secondary flex-shrink-0">
              {user.profile_picture ? (
                <img src={user.profile_picture} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-primary/20 text-primary flex items-center justify-center font-bold">
                  <User className="h-12 w-12" />
                </div>
              )}
            </div>
            
            <h2 className="text-xl font-bold text-foreground">{user.name}</h2>
            
            {user.field && (
              <p className="text-sm font-medium text-primary mt-1">{user.field}</p>
            )}
            
            <div className="mt-6 w-full space-y-3 pt-6 border-t border-border/50">
              <div className="flex items-center text-sm text-muted-foreground">
                <Mail className="h-4 w-4 mr-3" />
                <span className="truncate">{user.email}</span>
              </div>
              <div className="flex items-center text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 mr-3" />
                <span>Joined {joinDate}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Details */}
        <div className="md:col-span-2 space-y-8">
          <section className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">Personal Information</h3>
                <p className="text-xs text-muted-foreground mt-1">Update your personal details here.</p>
              </div>
              <button className="border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted text-foreground inline-flex items-center justify-center gap-1.5 rounded-md transition-colors">
                <Edit3 className="h-3 w-3" />
                <span>Edit</span>
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">First Name</label>
                <div className="text-sm text-foreground font-medium">{user.first_name || '—'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Last Name</label>
                <div className="text-sm text-foreground font-medium">{user.last_name || '—'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Email Address</label>
                <div className="text-sm text-foreground font-medium">{user.email}</div>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Phone Number</label>
                <div className="text-sm text-foreground font-medium">{user.phone || '—'}</div>
              </div>
            </div>
          </section>

          {/* Shortcuts */}
          <section className="bg-card/50 backdrop-blur-xl border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="divide-y divide-border/50">
              <Link to="/dashboard/settings#billing" className="flex items-center justify-between p-5 hover:bg-muted/50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-primary/10 rounded-lg text-primary">
                    <Briefcase className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">Billing Settings</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Manage your current subscriptions and payment methods</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
