import { NextRequest, NextResponse } from 'next/server';
import { templateService } from '@/services/template.service';

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const template = await templateService.getTemplate(params.id);
        return NextResponse.json(template);
    } catch (error: any) {
        console.error('Error getting template:', error);

        if (error.message === 'Template not found') {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }

        return NextResponse.json(
            { error: error.message || 'Failed to get template' },
            { status: 500 }
        );
    }
}
