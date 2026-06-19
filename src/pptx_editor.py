import sys
import os
import json
import argparse
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image

THEMES = {
    'classic': {
        'bgLight': 'FFFFFF',
        'bgDark': '0F172A',
        'primaryText': '1E293B',
        'secondaryText': '475569',
        'accent': '1E3A8A',
        'accentLight': '93C5FD'
    },
    'minimalist': {
        'bgLight': '121212',
        'bgDark': '1E1E1E',
        'primaryText': 'E2E8F0',
        'secondaryText': '94A3B8',
        'accent': 'A855F7',
        'accentLight': '22D3EE'
    },
    'corporate': {
        'bgLight': 'F3F4F6',
        'bgDark': '111827',
        'primaryText': '1F2937',
        'secondaryText': '4B5563',
        'accent': '059669',
        'accentLight': 'A7F3D0'
    }
}

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    return RGBColor(*(int(hex_str[i:i+2], 16) for i in (0, 2, 4)))

def find_title_shape(slide):
    # 1. Intentar buscar por título de layout estándar
    if slide.shapes.title:
        return slide.shapes.title
    
    # 2. Buscar por coincidencia de texto (placeholders comunes o texto inicial de Canva)
    placeholders = ["{{title}}", "{{titulo}}", "título de la presentación", "titulo de la presentacion", "título del proyecto", "titulo del proyecto"]
    for shape in slide.shapes:
        if shape.has_text_frame:
            text = shape.text_frame.text.lower()
            if any(p in text for p in placeholders):
                return shape
                
    # 3. Buscar el cuadro de texto con la fuente más grande en la diapositiva
    largest_font_size = 0
    best_shape = None
    
    for shape in slide.shapes:
        if shape.has_text_frame:
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if run.font.size and run.font.size > largest_font_size:
                        largest_font_size = run.font.size
                        best_shape = shape
                        
    # 4. Fallback: primer shape con texto
    if not best_shape:
        for shape in slide.shapes:
            if shape.has_text_frame:
                return shape
                
    return best_shape

def replace_text_keep_style(shape_or_cell, new_text):
    tf = shape_or_cell.text_frame
    
    # Guardar estilo original de la primera run si existe
    font_name = None
    font_size = None
    font_color = None
    bold = None
    italic = None
    
    if len(tf.paragraphs) > 0 and len(tf.paragraphs[0].runs) > 0:
        first_run = tf.paragraphs[0].runs[0]
        font_name = first_run.font.name
        font_size = first_run.font.size
        if first_run.font.color and first_run.font.color.type == 1:
            font_color = first_run.font.color.rgb
        bold = first_run.font.bold
        italic = first_run.font.italic
        
    tf.clear()
    
    # Dividir texto por líneas para preservar saltos de párrafo en lugar de un único bloque con saltos crudos
    lines = new_text.split('\n')
    for i, line in enumerate(lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = ""
        run = p.add_run()
        run.text = line
        
        # Reaplicar estilos
        if font_name:
            run.font.name = font_name
        if font_size:
            run.font.size = font_size
        if font_color:
            run.font.color.rgb = font_color
        if bold is not None:
            run.font.bold = bold
        if italic is not None:
            run.font.italic = italic



def extract_visual_dna(prs, default_bg='FFFFFF'):
    bg_hex = default_bg
    title_font = 'Arial'
    body_font = 'Calibri'
    title_color_rgb = (30, 58, 138)
    body_color_rgb = (30, 41, 59)
    
    if len(prs.slides) == 0:
        return bg_hex, title_font, body_font, title_color_rgb, body_color_rgb
        
    slide_ref = prs.slides[0]
    
    # 1. Extraer color de fondo
    if slide_ref.background and slide_ref.background.fill and slide_ref.background.fill.type == 1:
        color = slide_ref.background.fill.fore_color
        if color.type == 1:
            bg_hex = f"{color.rgb[0]:02X}{color.rgb[1]:02X}{color.rgb[2]:02X}"
    else:
        slide_area = prs.slide_width * prs.slide_height
        found_bg_shape = False
        for shape in slide_ref.shapes:
            if shape.width and shape.height:
                shape_area = shape.width * shape.height
                if shape_area >= 0.9 * slide_area:
                    if shape.fill and shape.fill.type == 1:
                        color = shape.fill.fore_color
                        if color.type == 1:
                            bg_hex = f"{color.rgb[0]:02X}{color.rgb[1]:02X}{color.rgb[2]:02X}"
                            found_bg_shape = True
                            break
        
        if not found_bg_shape:
            layout = slide_ref.slide_layout
            if layout.background and layout.background.fill and layout.background.fill.type == 1:
                color = layout.background.fill.fore_color
                if color.type == 1:
                    bg_hex = f"{color.rgb[0]:02X}{color.rgb[1]:02X}{color.rgb[2]:02X}"
            else:
                master = layout.slide_master
                if master.background and master.background.fill and master.background.fill.type == 1:
                    color = master.background.fill.fore_color
                    if color.type == 1:
                        bg_hex = f"{color.rgb[0]:02X}{color.rgb[1]:02X}{color.rgb[2]:02X}"
                        
    # 2. Extraer tipografía y color de título
    t_shape = find_title_shape(slide_ref)
    if t_shape and t_shape.has_text_frame:
        for paragraph in t_shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.font.name:
                    title_font = run.font.name
                if run.font.color and run.font.color.type == 1:
                    title_color_rgb = (run.font.color.rgb[0], run.font.color.rgb[1], run.font.color.rgb[2])
                if title_font != 'Arial' or title_color_rgb != (30, 58, 138):
                    break
            if title_font != 'Arial':
                break
                
    # 3. Extraer tipografía y color de cuerpo
    found_body = False
    for slide in prs.slides:
        s_title = find_title_shape(slide)
        for shape in slide.shapes:
            if shape.has_text_frame and shape != s_title:
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        if run.font.name:
                            body_font = run.font.name
                        if run.font.color and run.font.color.type == 1:
                            body_color_rgb = (run.font.color.rgb[0], run.font.color.rgb[1], run.font.color.rgb[2])
                        if body_font != 'Calibri':
                            found_body = True
                            break
                    if found_body:
                        break
            if found_body:
                break
        if found_body:
            break
            
    if not found_body:
        try:
            master = prs.slide_master
            for placeholder in master.placeholders:
                if placeholder.placeholder_format.type == 2:
                    if placeholder.has_text_frame and len(placeholder.text_frame.paragraphs) > 0:
                        tf = placeholder.text_frame
                        if len(tf.paragraphs[0].runs) > 0:
                            run = tf.paragraphs[0].runs[0]
                            if run.font.name:
                                body_font = run.font.name
                            if run.font.color and run.font.color.type == 1:
                                body_color_rgb = (run.font.color.rgb[0], run.font.color.rgb[1], run.font.color.rgb[2])
        except Exception:
            pass
            
    return bg_hex, title_font, body_font, title_color_rgb, body_color_rgb

def add_bullet_points(slide, bullets, left, top, width, height, colors, font_name='Calibri', font_size=14):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0)
    tf.margin_right = Inches(0)
    tf.margin_top = Inches(0)
    tf.margin_bottom = Inches(0)
    
    for i, bullet_text in enumerate(bullets):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        
        p.text = bullet_text
        p.level = 0
        p.space_after = Pt(10)
        
        # Estilo de runs
        for run in p.runs:
            run.font.name = font_name
            run.font.size = Pt(font_size)
            run.font.color.rgb = hex_to_rgb(colors['primaryText'])

def add_contained_image(slide, image_path, left, top, width, height):
    try:
        if not os.path.exists(image_path):
            return
            
        with Image.open(image_path) as img:
            img_w, img_h = img.size
        
        img_aspect = img_w / img_h
        box_aspect = width / height
        
        if img_aspect > box_aspect:
            # Ancho manda
            new_w = width
            new_h = width / img_aspect
            new_left = left
            new_top = top + (height - new_h) / 2
        else:
            # Alto manda
            new_h = height
            new_w = height * img_aspect
            new_top = top
            new_left = left + (width - new_w) / 2
            
        slide.shapes.add_picture(image_path, Inches(new_left), Inches(new_top), Inches(new_w), Inches(new_h))
    except Exception as e:
        print(f"Error rendering image {image_path}: {str(e)}", file=sys.stderr)

def parse_keep_slides(input_str):
    result = set()
    if not input_str:
        return result
    parts = input_str.split(',')
    for part in parts:
        trimmed = part.strip()
        if not trimmed:
            continue
        if '-' in trimmed:
            range_parts = trimmed.split('-')
            if len(range_parts) == 2:
                try:
                    start = int(range_parts[0].strip())
                    end = int(range_parts[1].strip())
                    if start <= end:
                        for i in range(start, end + 1):
                            result.add(i)
                except ValueError:
                    pass
        else:
            try:
                result.add(int(trimmed))
            except ValueError:
                pass
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--slides-json', required=True)
    parser.add_argument('--image-map-json', required=True)
    parser.add_argument('--theme', default='classic')
    parser.add_argument('--inherit-style', default='no')
    parser.add_argument('--keep-slides', default='1-3')
    parser.add_argument('--output', required=True)
    
    args = parser.parse_args()
    
    if not os.path.exists(args.base):
        print(f"Base file not found: {args.base}", file=sys.stderr)
        sys.exit(1)
        
    try:
        prs = Presentation(args.base)
    except Exception as e:
        print(f"Error loading PPTX base: {str(e)}", file=sys.stderr)
        sys.exit(1)
        
    # 1. Conservación y Limpieza (Smart Merge con Selección Manual)
    keep_slides = parse_keep_slides(args.keep_slides)
    to_delete = [i for i in range(len(prs.slides)) if (i + 1) not in keep_slides]
    to_delete.sort(reverse=True)
    
    print("User Selection [KEEP] ---> [CLEANING SLIDES]  ---> Static Slides Ready")
    for idx in to_delete:
        if idx < len(prs.slides):
            slide_id_list = list(prs.slides._sldIdLst)
            rId = slide_id_list[idx].rId
            prs.slides._sldIdLst.remove(slide_id_list[idx])
            prs.part.drop_rel(rId)
            
    if len(prs.slides) == 0:
        # Si no tiene diapositivas, crear una portada en blanco
        blank_layout = prs.slide_layouts[0]
        prs.slides.add_slide(blank_layout)
        
    # 4. Cargar diapositivas e imágenes dinámicas
    try:
        with open(args.slides_json, 'r', encoding='utf-8') as f:
            slides_data = json.load(f)
        with open(args.image_map_json, 'r', encoding='utf-8') as f:
            image_map = json.load(f)
    except Exception as e:
        print(f"Error parsing JSON inputs: {str(e)}", file=sys.stderr)
        sys.exit(1)
        
    # 5. Detectar layout en blanco en la plantilla
    blank_layout = None
    for l in prs.slide_layouts:
        if l.name and l.name.lower() in ['blank', 'vacía', 'vacia', 'blanco']:
            blank_layout = l
            break
            
    if not blank_layout:
        if len(prs.slide_layouts) > 6:
            blank_layout = prs.slide_layouts[6]
        else:
            blank_layout = prs.slide_layouts[0]
            
    # 6. Resolución de Estilos (Visual DNA)
    theme_colors = None
    title_font_name = 'Arial'
    body_font_name = 'Calibri'
    
    if args.inherit_style == 'yes' and len(prs.slides) > 0:
        bg_hex, title_font_name, body_font_name, title_color_rgb, body_color_rgb = extract_visual_dna(prs)
        
        theme_colors = {
            'bgLight': bg_hex,
            'bgDark': '0F172A',
            'primaryText': f"{body_color_rgb[0]:02X}{body_color_rgb[1]:02X}{body_color_rgb[2]:02X}",
            'secondaryText': '64748B',
            'accent': f"{title_color_rgb[0]:02X}{title_color_rgb[1]:02X}{title_color_rgb[2]:02X}",
            'accentLight': 'A5B4FC'
        }
        print("Canva Template [BASE] ---> [EXTRACTING STYLE] ---> Style Engine")
        print(f"[DNA] Estilo extraído: Fondo={bg_hex}, Título={title_font_name}, Cuerpo={body_font_name}")
    else:
        theme_colors = THEMES.get(args.theme, THEMES['classic'])
        
    W_val = prs.slide_width.inches
    H_val = prs.slide_height.inches
    
    slides_list = slides_data.get('slides', [])
    total_slides = len(slides_list)
    print("AI Expert [Dynamic]   ---> [INHERITING STYLE] ---> Final Merge")
    print(f"[APPEND] Añadiendo {total_slides} diapositivas dinámicas al final de la presentación...")
    
    # 7. Inyectar diapositivas
    for index, slide_data in enumerate(slides_list):
        slide = prs.slides.add_slide(blank_layout)
        
        # Fondo del slide
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = hex_to_rgb(theme_colors['bgLight'])
        
        # Título del slide
        title_left = Inches(0.06 * W_val)
        title_top = Inches(0.07 * H_val)
        title_width = Inches(0.88 * W_val)
        title_height = Inches(0.08 * H_val)
        
        title_box = slide.shapes.add_textbox(title_left, title_top, title_width, title_height)
        tf_title = title_box.text_frame
        tf_title.word_wrap = True
        tf_title.margin_left = Inches(0)
        tf_title.margin_right = Inches(0)
        tf_title.margin_top = Inches(0)
        tf_title.margin_bottom = Inches(0)
        
        p_title = tf_title.paragraphs[0]
        run_title = p_title.add_run()
        run_title.text = slide_data['title']
        run_title.font.name = title_font_name
        run_title.font.size = Pt(22)
        run_title.font.bold = True
        run_title.font.color.rgb = hex_to_rgb(theme_colors['accent'])
        
        # Rectángulo de acento
        accent_left = Inches(0.06 * W_val)
        accent_top = Inches(0.15 * H_val)
        accent_width = Inches(0.12 * W_val)
        accent_height = Inches(0.007 * H_val)
        
        accent_shape = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            accent_left, accent_top, accent_width, accent_height
        )
        accent_shape.fill.solid()
        accent_shape.fill.fore_color.rgb = hex_to_rgb(theme_colors['accent'])
        accent_shape.line.fill.background()
        
        # Determinar si tiene imagen
        original_img = slide_data.get('associatedImage')
        local_img = image_map.get(original_img) if original_img else None
        has_image = bool(local_img and os.path.exists(local_img))
        
        if slide_data.get('type') == 'image-focus':
            if has_image:
                img_left = 0.10 * W_val
                img_top = 0.21 * H_val
                img_width = 0.80 * W_val
                img_height = 0.60 * H_val
                add_contained_image(slide, local_img, img_left, img_top, img_width, img_height)
                
            caption = slide_data['bullets'][0] if slide_data.get('bullets') else ""
            if caption:
                cap_left = Inches(0.10 * W_val)
                cap_top = Inches(0.83 * H_val)
                cap_width = Inches(0.80 * W_val)
                cap_height = Inches(0.09 * H_val)
                
                cap_box = slide.shapes.add_textbox(cap_left, cap_top, cap_width, cap_height)
                tf_cap = cap_box.text_frame
                tf_cap.word_wrap = True
                tf_cap.margin_left = Inches(0)
                tf_cap.margin_right = Inches(0)
                tf_cap.margin_top = Inches(0)
                tf_cap.margin_bottom = Inches(0)
                
                p_cap = tf_cap.paragraphs[0]
                p_cap.alignment = PP_ALIGN.CENTER
                run_cap = p_cap.add_run()
                run_cap.text = caption
                run_cap.font.name = body_font_name
                run_cap.font.size = Pt(13)
                run_cap.font.italic = True
                run_cap.font.color.rgb = hex_to_rgb(theme_colors['secondaryText'])
                
        elif has_image:
            # 2 Columnas (Texto 40% izquierda, Imagen 55% derecha)
            t_left = Inches(0.05 * W_val)
            t_top = Inches(0.25 * H_val)
            t_width = Inches(0.40 * W_val)
            t_height = Inches(0.64 * H_val)
            add_bullet_points(slide, slide_data['bullets'], t_left, t_top, t_width, t_height, theme_colors, font_name=body_font_name, font_size=14)
            
            img_left = 0.45 * W_val
            img_top = 0.25 * H_val
            img_width = 0.50 * W_val
            img_height = 0.64 * H_val
            add_contained_image(slide, local_img, img_left, img_top, img_width, img_height)
            
        else:
            # 1 Columna (Texto 80% centrado)
            t_left = Inches(0.10 * W_val)
            t_top = Inches(0.25 * H_val)
            t_width = Inches(0.80 * W_val)
            t_height = Inches(0.64 * H_val)
            add_bullet_points(slide, slide_data['bullets'], t_left, t_top, t_width, t_height, theme_colors, font_name=body_font_name, font_size=15)
            
        # Paginación
        page_left = Inches(0.90 * W_val)
        page_top = Inches(0.92 * H_val)
        page_width = Inches(0.08 * W_val)
        page_height = Inches(0.03 * H_val)
        
        page_box = slide.shapes.add_textbox(page_left, page_top, page_width, page_height)
        tf_page = page_box.text_frame
        p_page = tf_page.paragraphs[0]
        p_page.alignment = PP_ALIGN.RIGHT
        run_page = p_page.add_run()
        run_page.text = f"{index + 1} / {total_slides}"
        run_page.font.name = body_font_name
        run_page.font.size = Pt(10)
        run_page.font.color.rgb = hex_to_rgb(theme_colors['secondaryText'])
        
    try:
        prs.save(args.output)
        print(f"[FILE] Archivo PPTX guardado con éxito en: {args.output}")
    except Exception as e:
        print(f"Error saving file: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
