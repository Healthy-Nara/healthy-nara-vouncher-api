import fs from 'fs';

const content = `import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdminNAReportById } from '../api';
import {
  ArrowLeft, Droplets, Baby, Moon, Activity,
  AlertCircle, CheckCircle2, Clock, Loader2
} from 'lucide-react';

const NAReportDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: report, isLoading } = useQuery({
    queryKey: ['adminNAReport', id],
    queryFn: () => getAdminNAReportById(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-green-50">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-green-50">
        <p className="text-gray-500">Report ရှာမတွေ့ပါ</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-green-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-primary/10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/na-reports')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-gray-900">Report အသေးစိတ်</h1>
            <p className="text-xs text-gray-500">{report.childName}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Status Badge */}
        <div className={\`flex items-center gap-2 p-4 rounded-xl \${
          report.status === 'submitted'
            ? 'bg-green-50 border border-green-200'
            : 'bg-yellow-50 border border-yellow-200'
        }\`}>
          {report.status === 'submitted' ? (
            <CheckCircle2 className="text-green-600" size={20} />
          ) : (
            <Clock className="text-yellow-600" size={20} />
          )}
          <div>
            <p className={\`font-semibold \${
              report.status === 'submitted' ? 'text-green-700' : 'text-yellow-700'
            }\`}>
              {report.status === 'submitted' ? 'ပေးပို့ပြီး' : 'မဖြည့်သေးပါ'}
            </p>
            {report.submittedAt && (
              <p className="text-xs text-green-600">
                ပေးပို့ချိန်: {new Date(report.submittedAt).toLocaleString('my-MM')}
              </p>
            )}
          </div>
        </div>

        {/* Nutrition & Feeding */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-primary/10">
          <div className="flex items-center gap-2 mb-4">
            <Droplets className="text-primary h-5 w-5" />
            <h2 className="font-bold text-gray-900">အာဟာရနှင့် အစာကျွေးခြင်း</h2>
          </div>

          {report.records?.filter((r) => r.category === 'Nutrition and Feeding').length > 0 ? (
            <div className="space-y-3">
              {report.records.filter((r) => r.category === 'Nutrition and Feeding').map((record, index) => (
                <div key={index} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-800">
                      {record.desc}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>အချိန်: {record.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">အစာကျွေးချိန် မရှိပါ</p>
          )}
        </div>

        {/* Personal Hygiene */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-primary/10">
          <div className="flex items-center gap-2 mb-4">
            <Baby className="text-primary h-5 w-5" />
            <h2 className="font-bold text-gray-900">တစ်ကိုယ်ရည် သန့်ရှင်းရေး</h2>
          </div>

          {report.records?.filter((r) => r.category === 'Personal Hygiene').length > 0 ? (
            <div className="space-y-3">
              {report.records.filter((r) => r.category === 'Personal Hygiene').map((record, index) => (
                <div key={index} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-800">
                      {record.desc}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>အချိန်: {record.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">သန့်ရှင်းရေးမှတ်တမ်း မရှိပါ</p>
          )}
        </div>

        {/* Sleeping */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-primary/10">
          <div className="flex items-center gap-2 mb-4">
            <Moon className="text-primary h-5 w-5" />
            <h2 className="font-bold text-gray-900">အိပ်ချိန်</h2>
          </div>

          {report.records?.filter((r) => r.category === 'Sleeping').length > 0 ? (
            <div className="space-y-3">
              {report.records.filter((r) => r.category === 'Sleeping').map((record, index) => (
                <div key={index} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-800">
                      {record.desc}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>အချိန်: {record.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">အိပ်ချိန် မရှိပါ</p>
          )}
        </div>

        {/* Activity & Exercise */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-primary/10">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="text-primary h-5 w-5" />
            <h2 className="font-bold text-gray-900">လှုပ်ရှားမှုနှင့် လေ့ကျင့်ခန်း</h2>
          </div>

          {report.records?.filter((r) => r.category === 'Activity and exercise').length > 0 ? (
            <div className="space-y-3">
              {report.records.filter((r) => r.category === 'Activity and exercise').map((record, index) => (
                <div key={index} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-800">
                      {record.desc}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>အချိန်: {record.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">လှုပ်ရှားမှု မရှိပါ</p>
          )}
        </div>

        {/* Analysis & Unusual Findings */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-primary/10">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="text-primary h-5 w-5" />
            <h2 className="font-bold text-gray-900">သုံးသပ်ချက်နှင့် ထူးခြားဖြစ်စဉ်များ</h2>
          </div>

          {report.records?.filter((r) => r.category === 'Analysis and Unusual Findings').length > 0 ? (
            <div className="space-y-3">
              {report.records.filter((r) => r.category === 'Analysis and Unusual Findings').map((record, index) => (
                <div key={index} className="bg-red-50 rounded-xl p-3 border border-red-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-red-700 whitespace-pre-wrap">
                      {record.desc}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-red-500">
                    <span>အချိန်: {record.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">ထူးခြားဖြစ်စဉ် မရှိပါ</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default NAReportDetail;
`;

fs.writeFileSync('c:/Users/PC/Desktop/healthy-nara-vouncher/frontend/src/pages/NAReportDetail.tsx', content, 'utf8');
console.log('File successfully updated with correct characters!');
