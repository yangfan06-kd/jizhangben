from fastapi import APIRouter, Depends, Request, Response, status

from ..dependencies import get_current_user_id
from ..schemas.options import (
    CategoryCreateRequest,
    CategoryListResponse,
    CategoryResponse,
    CategoryUpdateRequest,
    RecordTypeCreateRequest,
    RecordTypeListResponse,
    RecordTypeResponse,
    RecordTypeUpdateRequest,
)
from ..schemas.records import ErrorResponse
from ..services.option_service import (
    archive_category,
    archive_record_type,
    create_category,
    create_record_type,
    list_categories,
    list_record_types,
    update_category,
    update_record_type,
)


router = APIRouter(tags=["options"])


@router.get("/api/categories", response_model=CategoryListResponse)
def get_categories(
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return {
        "items": list_categories(
            request.app.state.database_path,
            current_user_id,
        )
    }


@router.post(
    "/api/categories",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def post_category(
    payload: CategoryCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return create_category(
        request.app.state.database_path,
        current_user_id,
        payload.name,
    )


@router.patch(
    "/api/categories/{category_id}",
    response_model=CategoryResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def patch_category(
    category_id: str,
    payload: CategoryUpdateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return update_category(
        request.app.state.database_path,
        current_user_id,
        category_id,
        payload.name,
    )


@router.delete(
    "/api/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
    },
)
def delete_category(
    category_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> Response:
    archive_category(request.app.state.database_path, current_user_id, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/record-types", response_model=RecordTypeListResponse)
def get_record_types(
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return {
        "items": list_record_types(
            request.app.state.database_path,
            current_user_id,
        )
    }


@router.post(
    "/api/record-types",
    response_model=RecordTypeResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def post_record_type(
    payload: RecordTypeCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return create_record_type(
        request.app.state.database_path,
        current_user_id,
        payload.code,
        payload.name,
        payload.behavior,
    )


@router.patch(
    "/api/record-types/{type_id}",
    response_model=RecordTypeResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def patch_record_type(
    type_id: str,
    payload: RecordTypeUpdateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return update_record_type(
        request.app.state.database_path,
        current_user_id,
        type_id,
        payload.name,
    )


@router.delete(
    "/api/record-types/{type_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
    },
)
def delete_record_type(
    type_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> Response:
    archive_record_type(request.app.state.database_path, current_user_id, type_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
